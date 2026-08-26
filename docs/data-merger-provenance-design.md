# Data Merger + per-field provenance — design + P1/P2 реализованы

Спроектировано по запросу пользователя как реакция на
[`SEO_Web_Discovery_JSON_LD_Project_Rules.md`](./SEO_Web_Discovery_JSON_LD_Project_Rules.md)
§24–§27 («Промежуточная модель», «Объединение нескольких источников», «Приоритет
и confidence», «Проверка конфликтов»). Изначально это был чистый дизайн,
осознанно отделённый от точечных правок JSON-LD-конвейера
(`src/lib/search/structured-data.ts`, `providers/generic/provider.ts`).

> **Обновление.** Фазы **P1 и P2 (§4) реализованы**: `search_extracted_listings` +
> `search_field_conflicts` (миграция `20260826090001_search_extracted_listings.sql`),
> чистая логика сравнения — `src/server/search/registry/listing-merge.ts`
> (`listing-merge.test.ts`), I/O-обвязка — `registry/extracted-listings.ts`, вызывается
> из `providers/generic/provider.ts` после каждой успешной нормализации (best-effort,
> не блокирует и не читается обратно живым поиском — P1 остаётся строго аддитивным, как
> и планировалось). Открытые конфликты по источнику видны в
> `/admin/search-sources/[id]/urls`. **P3 (живой поиск читает индекс) не начат** — см.
> §4 ниже, он и в исходном плане был отдельным, самым рискованным шагом.

Файлы, о которых идёт речь:

- `src/lib/search/result.ts` — текущая `VesselSearchResult`/`FieldProvenance`, которую
  этот дизайн расширяет, а не заменяет.
- `src/server/search/providers/generic/provider.ts` — текущий каскад
  «селекторы → JSON-LD → AI», строго последовательный, ключевая причина, почему
  Data Merger негде разместить сегодня (см. §1).
- `supabase/migrations/20260824110001_search_source_url_registry.sql` — `search_source_urls`,
  ближайшая существующая таблица к тому, что нужно расширить.
- `docs/CLAUDE_SITEMAP_AI_CRAWLER_RULE.md`, `docs/search-source-processing-strategies.md` —
  существующие §-нумерованные design-документы этого же стиля.

---

## 1. Почему полноценный Data Merger/Conflict Detector сегодня негде разместить

Rules-документ (§4) описывает архитектуру, где пользовательский поиск бьёт по
**локальному индексу уже извлечённых сущностей**, а живой обход — это отдельный,
фоновый процесс discovery/refresh. У нас сегодня не так:

```text
Rules-документ (§4):          Что реально есть:

User Search                    User Search
    |                              |
    v                              v
Local Search Index  <---      HTTP Fetch (живой, в рамках запроса)
    ^                              |
    |                              v
Discovery/Extraction          Extraction (селекторы → JSON-LD → AI)
(фоновый процесс)                  |
                                    v
                            VesselSearchResult (эфемерный,
                            никуда не пишется)
```

`search_source_urls` хранит **обнаруженные URL и метаданные обхода**
(`crawl_status`, `content_hash`, `last_fetched_at`) — но не сами извлечённые
поля судна (name/price/guests/...). Каждый пользовательский поиск заново фетчит
и заново извлекает данные с выбранных URL (`providers/generic/provider.ts`
`fetchCandidates`), в рамках `context.timeoutMs`. Ничего не сохраняется между
запросами, кроме сырого HTML (`search_page_cache`, по возрасту, не по ETag/304 —
отдельный, более мелкий пробел из того же документа, §38).

Второе структурное препятствие — сам каскад извлечения **строго
последовательный и взаимоисключающий**:

```ts
if (source.selectorConfig) { /* ...return... */ }
const structured = extractJsonLdFields(page.html);
if (structured?.name) { /* ...return... */ }
if (!allowAi) return { result: null, ... };
const { classification } = await classifyCached(page.html);
```

Первый сработавший уровень **обрывает** цепочку — селекторы, JSON-LD и AI
никогда не выполняются оба для одной и той же страницы в рамках одного запроса.
У Conflict Detector в духе §27 («JSON-LD price = 8000, HTML price = 11000»)
буквально нет второго значения, с которым сравнивать — оба значения одновременно
просто никогда не существуют.

**Вывод:** прежде чем строить Data Merger/Conflict Detector в том виде, как их
описывает документ, нужно решить два предварительных архитектурных вопроса —
(а) где персистится извлечённая сущность и (б) в какой момент вообще возникают
два независимых значения одного поля для сравнения. Раздел §3 ниже — предлагаемый
ответ на оба.

---

## 2. Что уже есть и что это решение не отменяет

`FieldProvenance` (`result.ts`) уже реализует **узкую** версию provenance:

```ts
export interface FieldProvenance {
  sourceUrl: string | null;
  /** 0.0-1.0. `null` when the value came from a deterministic source rather than a model. */
  confidence: number | null;
}
```

Соглашение проекта: **provenance пишется только для AI-полей**; отсутствие
записи — это и есть сигнал «детерминированный источник, доверяем как есть»
(см. `normalize.ts`: `aiConfidence !== null ? {...} : null`). Это осознанно
более простая модель, чем §26 документа («каждое поле должно иметь источник и
confidence», включая детерминированные с confidence=HIGH) — и именно поэтому
пункт 1 из трёх согласованных сейчас изменений (price/offers из JSON-LD) **не
трогает** это соглашение: цена из JSON-LD остаётся без записи в `fieldProvenance`,
как name/description/image уже сегодня.

Этот дизайн предлагает **не переписывать** текущее соглашение для эфемерного
пути (оно и так работает, покрыто тестами, ломать не нужно) — а завести
**отдельную, персистентную** модель под её собственную задачу: сравнение
значений одного поля, добытых в *разное время* или *разными провайдерами*.

---

## 3. Предлагаемая модель

### 3.1 Новая таблица — `search_extracted_listings`

Одна строка на `(source_id, url)` — последнее известное нормализованное
состояние объявления, с provenance/confidence **на каждое поле**, не только
AI-полученное:

```sql
create type public.search_field_source as enum (
  'SELECTOR', 'JSON_LD', 'AI', 'MANUAL'
);

create table public.search_extracted_listings (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.search_sources (id) on delete cascade,
  url text not null,

  -- Текущее «лучшее известное» нормализованное состояние — та же форма полей,
  -- что VesselSearchResult, а не отдельная параллельная модель.
  name text,
  description text,
  price_minor integer,
  currency text,
  guests integer,
  cabins integer,
  vessel_type_raw text,
  country text,
  city text,

  -- Provenance на КАЖДОЕ поле выше — { source: SEARCH_FIELD_SOURCE, confidence: 0..1|null,
  -- retrievedAt: timestamptz, sourceUrl: text }, keyed по имени поля. JSONB, не отдельные
  -- колонки на каждое поле × каждый атрибут provenance — та же денормализация, что
  -- `fieldProvenance` в VesselSearchResult уже выбрала, только персистентная.
  field_provenance jsonb not null default '{}',

  last_extracted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_id, url)
);
```

### 3.2 Когда вообще возникает «конфликт»

Не «AI против JSON-LD в одном запросе» (см. §1 — этого не бывает), а **новое
значение против уже сохранённого**, при повторном обходе:

```text
Повторный обход URL
        |
        v
Извлекли значение X для поля F
        |
        v
Есть сохранённая запись для (source_id, url)?
        |
   +----+----+
   |         |
  НЕТ       ДА
   |         |
   v         v
 Записать   Значение поля F в записи == X (с допуском для чисел)?
 как есть        |
              +--+--+
              |     |
             ДА    НЕТ
              |     |
              v     v
          Обновить  Conflict: сохранить И старое, И новое
          last_      (log ниже), понизить confidence поля F,
          extracted   не перезаписывать молча
          _at
```

`price_minor` — тот случай, где нужен допуск на округление/колебание курса, а
не точное равенство; остальные поля (name/city/country/vesselTypeRaw) —
case-insensitive строковое сравнение.

### 3.3 Лог конфликтов — `search_field_conflicts`

```sql
create table public.search_field_conflicts (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.search_extracted_listings (id) on delete cascade,
  field text not null,
  previous_value jsonb not null,
  new_value jsonb not null,
  previous_source public.search_field_source not null,
  new_source public.search_field_source not null,
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution text -- 'kept_previous' | 'kept_new' | 'manual'
);
```

Не решается автоматически «кто прав» (документ §27: «не должна молча
выбирать один вариант») — конфликт остаётся видимым (админ-страница реестра
источника — естественное место) до тех пор, пока новое значение не
подтвердится повторно (два обхода подряд согласны) или админ не разрешит
вручную.

### 3.4 Модель confidence по источникам (§26)

```text
SELECTOR (admin-configured)   HIGH   (0.95, фиксированно — не модель)
JSON_LD                       HIGH   (0.9 — минус чуть-чуть за то, что мы не
                                       проверяем `@context` на точный schema.org)
AI                             как есть, `classification.confidence` (0.0–1.0)
MANUAL (админ вручную)         HIGH   (1.0 — явное решение человека)
```

Это единственное отличие от §26 «текущего» узкого соглашения (§2 выше) — здесь
confidence пишется на КАЖДОЕ поле, включая детерминированные, потому что сама
задача (сравнение во времени) без этого не работает: чтобы понизить confidence
при конфликте (§27), у поля должен быть confidence, от которого понижать.

---

## 4. Фазы внедрения (явно не единый PR)

| Фаза | Что делает | Что НЕ делает |
|---|---|---|
| **P1** | ✅ Реализовано. `search_extracted_listings` пишется *дополнительно* к текущему эфемерному пути — каждый успешный `fetchAndNormalize` апсертит строку через `registry/extracted-listings.ts`. Живой поиск как был — читает через каскад, эту таблицу не читает вообще. | Не меняет ответ пользователю ни на бит. |
| **P2** | ✅ Реализовано. `search_field_conflicts` + сравнение при апсерте (§3.2/3.3, `listing-merge.ts`). Страница `/admin/search-sources/[id]/urls` показывает открытые конфликты по этому source (`getOpenFieldConflicts`). | Не блокирует показ результата пользователю — конфликт логируется, старое значение продолжает служить. Ручное разрешение конфликта админом (кнопка «принять новое значение») не реализовано — сейчас единственный путь разрешения открытого конфликта, кроме прямой правки в БД, это подтверждение вторым, независимым обходом (§3.2). |
| **P3** | Не начато. Живой поиск сначала читает `search_extracted_listings` (если запись свежая — spec §4's "Local Search Index"), `fetchAndNormalize` становится background refresh, а не единственным путём. | Это отдельный, самый рискованный шаг — меняет модель latency/freshness всего внешнего поиска, требует отдельного решения о TTL/freshness check (§38 rules-документа: ETag/If-Modified-Since). |

---

## 5. Открытые вопросы (нужно решить до P1, не решается этим документом)

1. **Хранение данных конкурентов.** `search_extracted_listings` персистентно
   хранит нормализованные данные с чужих сайтов дольше одного запроса — это
   не то же самое, что нынешний `search_page_cache` (сырой HTML, TTL 24ч).
   Нужна ли отдельная политика хранения/TTL, отличная от текущего кэша?
   **Не решено** — таблица пока не чистится отдельным job'ом, как и
   `search_page_cache`.
2. **Объём миграции.** ~~Две новые таблицы + enum — риск мёртвого кода без
   потребителя.~~ Снято реализацией P1+P2: обе таблицы пишутся при каждом
   успешном извлечении, и открытые конфликты видны в админке — потребитель
   есть с первого дня, просто это не живой поиск (P3).
3. **`price_minor`-допуск для conflict-сравнения** — **решено практическим
   значением**, не окончательным: 1% от предыдущего значения, но не менее
   100 минорных единиц (`listing-merge.ts`'s `PRICE_TOLERANCE_RATIO`/
   `PRICE_TOLERANCE_MIN_MINOR`). Не per-currency и не основано на реальных
   данных о колебаниях (их всё ещё нет) — первое приближение, которое стоит
   пересмотреть, когда в `search_field_conflicts` накопится реальная история
   по `price_minor`.
