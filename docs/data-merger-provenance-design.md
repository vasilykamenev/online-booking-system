# Data Merger + per-field provenance — design + P1/P2/P3 реализованы

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
> `/admin/search-sources/[id]/urls`.
>
> **P3 (живой поиск читает индекс) реализован** (миграция
> `20260826150001_search_index_read_path.sql`): `providers/generic/provider.ts`'s
> `fetchCandidate` теперь сначала спрашивает `registry/listing-index.ts`'s
> `getFreshListing(sourceId, url, INDEX_FRESHNESS_MS)`; при попадании — собирает
> `VesselSearchResult` прямо из строки индекса (`listingRowToResult`,
> `listing-index.test.ts`), без единого HTTP-запроса и без AI-вызова; при промахе (нет
> строки или она старше `INDEX_FRESHNESS_MS = PAGE_CACHE_MS`, 24ч) — как раньше, живой
> `fetchAndNormalize`, который и обновляет индекс. Только generic-провайдер — brilions
> никогда не писал в индекс, поэтому и не читает из него. Добавлена одна колонка сверх
> P1/P2-схемы: `search_extracted_listings.image` — простое, без provenance/conflict,
> last-write-wins поле (менять фото на URL-странице не в духе конфликта, это не
> сопоставимое поле), без него у карточки из индекса не было бы фото (CLAUDE.md §5).
> Замер эффекта — новая `search_runs.pages_from_index`. Живая проверка на локальной БД:
> повторный запрос "yacht rental greece" — `9.37s → 1.77s` (11 из 20 кандидатов у
> одного источника пошли из индекса вместо живого фетча), `pages_visited` не упал до
> нуля просто потому, что оставшиеся 9 URL — те, что вообще не дают листинг (значит и
> не пишутся в индекс), а не забытый кейс.

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
| **P2** | ✅ Реализовано, включая ручное разрешение. `search_field_conflicts` + сравнение при апсерте (§3.2/3.3, `listing-merge.ts`). Страница `/admin/search-sources/[id]/urls` показывает открытые конфликты по этому source (`getOpenFieldConflicts`) с кнопками «Accept new» / «Keep previous» (`resolveFieldConflict` в `server/actions/admin.ts`) — «Accept new» пишет `MANUAL`/confidence `1.0` (§3.4) через service-role клиент (RLS не даёт `authenticated` `update` на `search_extracted_listings` напрямую), с проверкой на гонку (отказ, если поле уже изменилось с момента фиксации конфликта). | Не блокирует показ результата пользователю — конфликт логируется, старое значение продолжает служить. Многократные открытые конфликты на одно поле (третье извлечение до разрешения первого) — по-прежнему известный, не устранённый пробел (`extracted-listings.ts`'s doc comment). |
| **P3** | ✅ Реализовано. Живой поиск сначала читает `search_extracted_listings` через `registry/listing-index.ts`'s `getFreshListing`; при свежей записи (`< INDEX_FRESHNESS_MS`) собирает результат без единого HTTP-запроса. `fetchAndNormalize` остаётся единственным писателем индекса — при промахе живой фетч выполняется как раньше и обновляет запись. | TTL — фиксированный, равный `PAGE_CACHE_MS` (24ч), не отдельно настраиваемое значение и не настоящий freshness-check. Полноценный ETag/If-Modified-Since (§38 rules-документа) по-прежнему не реализован — сокращается число живых фетчей, но не их стоимость каждый раз, когда TTL истёк. |

---

## 5. Открытые вопросы (нужно решить до P1, не решается этим документом)

1. **Хранение данных конкурентов.** ✅ **Решено для `search_extracted_listings`.**
   Ежедневный Vercel Cron (`vercel.json` → `/api/cron/cleanup-search-index`, защищён
   `CRON_SECRET`) вызывает `registry/index-retention.ts`'s `cleanupStaleListings` —
   удаляет строки старше `INDEX_RETENTION_MS` (90 дней, первое приближение, длиннее
   P3's `INDEX_FRESHNESS_MS` намеренно — см. файловый doc comment: запись, которую
   перестали читать, не обязательно нужно удалять немедленно, иначе теряется
   непрерывность conflict-сравнения для редко обходимых источников). Каскадно чистит
   и `search_field_conflicts` через `on delete cascade`. **`search_page_cache`
   остаётся отдельным, всё ещё нерешённым случаем той же проблемы** — не входил в
   рамки этой задачи, тот же пробел, что описан в README.
2. **Объём миграции.** ~~Две новые таблицы + enum — риск мёртвого кода без
   потребителя.~~ Снято реализацией P1+P2: обе таблицы пишутся при каждом
   успешном извлечении, и открытые конфликты видны в админке — потребитель
   есть с первого дня. Живой поиск как читатель — снято реализацией P3.
3. **`price_minor`-допуск для conflict-сравнения** — **решено практическим
   значением**, не окончательным: 1% от предыдущего значения, но не менее
   100 минорных единиц (`listing-merge.ts`'s `PRICE_TOLERANCE_RATIO`/
   `PRICE_TOLERANCE_MIN_MINOR`). Не per-currency и не основано на реальных
   данных о колебаниях (их всё ещё нет) — первое приближение, которое стоит
   пересмотреть, когда в `search_field_conflicts` накопится реальная история
   по `price_minor`.
4. **P3's TTL — единая фиксированная константа, не настоящий freshness-check.**
   ✅ **Решено.** `INDEX_FRESHNESS_MS` (24ч) по-прежнему определяет, когда P3 совсем
   не идёт в сеть — но теперь, если это окно истекло, `fetchCandidate`
   (`providers/generic/provider.ts`) не сразу делает полное переизвлечение: сначала
   `fetchWithCache` (`crawl/cached-fetch.ts`) пробует условный GET —
   `If-None-Match`/`If-Modified-Since` из `search_page_cache.etag`/`.last_modified`
   (миграция `20260826170001_conditional_revalidation.sql`), через новый
   `safeFetchConditional` (`crawl/safe-fetch.ts`). `304` — сайт подтвердил, что
   страница не менялась — переиспользует уже сохранённые в `search_extracted_listings`
   значения (`registry/extracted-listings.ts`'s `touchExtraction` просто продлевает
   `last_extracted_at`), полностью пропуская селекторы/JSON-LD/AI для этого кандидата.
   Замер — `search_runs.pages_revalidated_unchanged`.

   **Важная оговорка, подтверждённая вживую**: это optimisation "when available", не
   гарантия. У реального зарегистрированного источника (globesailor.ru, за
   Cloudflare, динамический PHP) в ответе нет ни `ETag`, ни `Last-Modified`, только
   `Cache-Control: no-store, no-cache, must-revalidate` — то есть у него условная
   ревалидация просто не активируется (`cached-fetch.ts` падает обратно на
   безусловный фетч, как и раньше), не заменяя фиксированный TTL, а дополняя его там,
   где источник вообще поддерживает валидаторы. ETag/If-Modified-Since-поддержка на
   реальных сайтах неоднородна — многие CMS её не отдают.

   Живая проверка: 5 юнит-тестов на `safeFetchConditional`/`fetchValidated`
   (`safe-fetch.test.ts`) — правильная отправка условных заголовков, корректный `304`
   *до* проверки диапазона редиректов (304 сам по себе 3xx — самое рискованное место
   в реализации), обычный редирект по-прежнему работает при заданных условных
   заголовках, SSRF-защита не ослаблена, безусловный `safeFetch` не отправляет
   условные заголовки и не меняет поведение. Полный набор (266/266) и живой поисковый
   запрос на локальной БД подтвердили отсутствие регрессий на реалистичном
   (без-валидатора) пути — сам `304`-сценарий не наблюдался вживую по причине выше
   (ни один зарегистрированный источник его не поддерживает), только через тесты.
