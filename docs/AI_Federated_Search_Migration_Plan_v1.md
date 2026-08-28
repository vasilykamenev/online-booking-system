# План миграции на AI Federated Vessel Search

Рабочий документ. Источник требований — [`AI_Federated_Vessel_Search_Architecture_v1.0.md`](./AI_Federated_Vessel_Search_Architecture_v1.0.md)
(далее «Арх»), ссылки вида «Арх §12» — на его разделы. Ссылки «Spec §N» — на старую спеку
[`../Global_AI_Vessel_Search_Prompt.md`](../Global_AI_Vessel_Search_Prompt.md), по которой построен
текущий код.

Статус: **план, не реализация.** Перестройка одобрена целиком, включая пересоздание БД.

---

## 1. Краткий вывод анализа

Текущая реализация — это **Spec-версия** того же замысла, остановившаяся на «живом краулинге в
пользовательском запросе». Арх требует принципиально другого центра тяжести:

| | Сейчас | По Арх |
|---|---|---|
| Внешний поиск | live-crawl внутри HTTP-запроса пользователя | SELECT по предварительному индексу |
| Роль AI в запросе | парсинг запроса + классификация/извлечение **каждой** страницы | парсинг запроса + semantic ranking; извлечение — при индексации и как fallback |
| Контракт источника | `search()` | `supports/search/getDetails/checkAvailability/getContactCapability` |
| Внутренний поиск | отдельная ветка кода, не адаптер | `InternalVesselAdapter`, такой же адаптер |
| Внешний результат | карточка со ссылкой | Contact Intent / Booking Intent с подтверждением |
| Доступность | не моделируется | `VERIFIED / LIKELY_AVAILABLE / UNKNOWN / UNAVAILABLE` + `confidence` |
| Типы судов | 5 значений enum платформы | 9 канонических + словарь синонимов источников |

**Хорошая новость:** нижний слой переиспользуется почти целиком. Инфраструктура краулинга
(`crawl/`), URL Registry, дедупликация, ранжирование, интерпретация запроса, админка источников,
прокси внешних изображений, SSRF/robots/защита от инъекций — всё это остаётся и получает новых
потребителей. Переписывается **средний слой**: оркестратор, контракт адаптера, модель оффера и
хранилище внешних данных.

**Плохая новость:** 30 из 46 тест-файлов проекта относятся к поиску, и большинство завязано на
`SearchCriteria`/`VesselSearchResult`. Расширение этих двух типов — самое дорогое единичное
изменение в плане, и оно должно идти первым, пока поверх него не наросло нового кода.

---

## 2. Инвентаризация: что есть сегодня

### 2.1 Код

```
src/lib/search/          criteria.ts, result.ts, ranking.ts, dedupe.ts, match-criteria.ts,
                         interpret-fallback.ts, vocabulary.ts, structured-data.ts, text.ts,
                         vessel-cursor.ts, page-text.ts, external-image-url.ts
src/server/ai/           client.ts (Anthropic + AI_MODELS + таймаут), query-interpreter.ts
src/server/search/       global-search-service.ts (оркестратор, 2 фазы)
                         internal-provider.ts (поиск по своей БД, НЕ адаптер)
                         providers.ts (интерфейс ExternalSearchProvider — только search())
                         provider-registry.ts (домен → провайдер, иначе generic)
                         source-registry.ts, source-validation.ts, candidate-classifier.ts
                         interpretation-cache.ts, search-run-log.ts, selector-suggestion.ts
  crawl/                 safe-fetch, robots(-rules), sitemap(-rules), full-sitemap-discovery,
                         page-cache, cached-fetch, ip-range
  registry/              url-classification, url-registry-sync, listing-index, listing-merge,
                         extracted-listings, source-breadcrumbs, index-retention
  providers/brilions/    сайт-специфичный провайдер (sitemap, extract, ai-extract, normalize)
  providers/generic/     фабрика провайдера для STRUCTURED_DATA/AI_EXTRACTION/селекторов
src/app/[locale]/(booking)/discover/   UI поиска
src/app/[locale]/admin/search-sources/ админка реестра + URL Registry + конфликты полей
src/app/api/cron/cleanup-search-index/ единственный cron (ретеншн индекса)
src/app/api/external-image/[encoded]/  прокси внешних фото с allowlist по реестру
```

### 2.2 Схема БД (поисковая подсистема)

| Таблица | Роль сейчас | Судьба по плану |
|---|---|---|
| `search_sources` | реестр источников | **пересоздаётся** как SourceProfile (Арх §8) |
| `search_source_urls` | URL Registry | сохраняется, +2 колонки |
| `search_source_crawl_rules` | правила классификации URL | сохраняется без изменений |
| `search_source_breadcrumbs` | хлебные крошки для резолва URL | сохраняется |
| `search_extracted_listings` | оппортунистический кэш извлечения | **заменяется** на `external_vessel_index` |
| `search_field_conflicts` | лог конфликтов полей | сохраняется, FK переезжает на новый индекс |
| `search_page_cache` | кэш сырого HTML | сохраняется |
| `search_runs` | метрики поиска | сохраняется, +колонки фаз |
| — | | **новые:** `search_source_coverage`, `search_source_policies`, `search_source_health`, `external_vessel_index`, `vessel_identities`, `vessel_identity_offers`, `contact_intents`, `vessel_type_aliases` |

Enum-ы: `search_processing_type` (`API|HTML|STRUCTURED_DATA|AI_EXTRACTION|HYBRID`) —
пересоздаётся под лестницу стратегий Арх §8. `vessel_type`
(`yacht|catamaran|expedition|research|hybrid`) — пересоздаётся под канонический словарь Арх §7,
и это ломающее изменение для всего каталога, не только для поиска.

---

## 3. Gap-анализ: Арх → текущий код

| Арх | Требование | Есть | Разрыв | Этап |
|---|---|---|---|---|
| §5 | `UniversalVesselSearchRequest` | `SearchCriteria` | нет `lat/lng`, `searchRadiusKm`, `priceUnit`, `vesselTypes[]` (множ.), `lengthMin/Max`, `crewType`, раздельных `amenities[]`/`activities[]` | Э2 |
| §6 | AI Query Parser | `query-interpreter.ts` | работает; нужен новый промпт под расширенную модель | Э2 |
| §7 | Canonical Vocabulary | enum из 5 значений | нужен enum из 9 + таблица синонимов источников | Э1 |
| §8 | `SourceProfile` (capabilities, access, extraction) | плоская строка реестра | нет `capabilities`, нет лестницы `GRAPHQL/SEARCH_URL/WEB_PARSER`, нет политик | Э3 |
| §9 | `SourceCoverage` | нет | новая таблица + предфильтр источников в оркестраторе | Э3 |
| §10 | `VesselSourceAdapter` (5 методов) | `ExternalSearchProvider` (1 метод) | +`supports`, `getDetails`, `checkAvailability`, `getContactCapability`; внутренний поиск — тоже адаптер | Э4 |
| §11 | `UniversalVesselOffer` | `VesselSearchResult` | нет `sourceId`, `externalId`, `availabilityStatus`, `confidence`, `indexedAt`, `verifiedAt`, `contactCapability` | Э2/Э7 |
| §12 | External Vessel Index | `search_extracted_listings` (кэш, 10 полей) | нужен полноценный индекс (~20 полей, гео, диапазоны цен/дат) + фоновое наполнение | Э5 |
| §13 | Двухфазный поиск (Candidate → Live Verification) | одна фаза live-crawl | новый оркестратор; крауль уходит в фон | Э6 |
| §14 | Internal First, `MIN_INTERNAL_RESULTS` | внешний контур всегда запускается | параметр + ветвление + «расширенный поиск» в UI | Э6 |
| §15 | Availability + Freshness | нет | 2 enum-а + сквозное протаскивание + правила показа | Э7 |
| §16 | Ranking (+source confidence, freshness) | `ranking.ts`, 8 факторов | +3 фактора; AI semantic ranking отдельно | Э6/Э11 |
| §17 | Deduplication → logical vessel entity | per-run merge | персистентная идентичность судна и её офферы | Э11 |
| §19 | Onboarding + Source Analyzer | `source-validation.ts` (доступность, sitemap, JSON-LD, превью) | +API/GraphQL detection, +генерация `SourceProfile`, +обнаружение смены структуры | Э10 |
| §20 | Contact / Booking Intent | нет | таблица, enum `ContactCapability`, Server Actions, AI-сообщение, подтверждение | Э9 |
| §22 | Производительность | таймаут, кэш страниц, тайм-бюджет | нет TOP-N-верификации, нет раздельных TTL, нет курсорной пагинации в discover | Э6/Э8 |
| §23 | Отказоустойчивость | таймаут, `Promise.allSettled` | нет circuit breaker, rate limit, health-статуса, метрик ошибок | Э8 |
| §24 | Политики источника | robots, SSRF, attribution в UI, cleanup-cron | нет `AccessPolicy/CachePolicy/AttributionPolicy/RateLimitPolicy/DataRetentionPolicy` как данных | Э3 |

---

## 4. Решение по базе данных

Пересоздание разрешено. Рекомендация — **не сносить всё, а снести поисковую подсистему**:

**Пересоздать с нуля (drop + новый baseline):** все `search_*` таблицы и связанные enum-ы.
Из 8 инкрементальных миграций поиска (`20260821140001` … `20260827200001`) новая архитектура меняет
структурно ~70%. Тянуть их эволюцию `alter`-ами дороже и хуже читается, чем один чистый набор.

**Сохранить, но изменить:** ядро (`profiles`, `vessels`, `locations`, `bookings`, `payments`,
`availability`, `pricing_rules`, `reviews`, `favorites`, `initiatives*`, `conversations`,
`messages`, `notifications`, `audit_log`). Единственное ломающее изменение здесь — enum
`vessel_type` (Э1). Эти таблицы несут бизнес-инварианты (BRD §11: зафиксированная цена брони,
exclusion constraint по датам), уже покрыты RLS и тестами — сносить их означает переделывать
работу, которую новая архитектура не трогает.

**Опция «полный сброс истории»** (сквош всех миграций в один `baseline.sql`): технически возможна и
даёт самую чистую отправную точку, но осмысленна только если в удалённой Supabase нет данных,
которые кому-то нужны. Решение — за пользователем, см. §8 «Открытые вопросы» п.1. План ниже не
зависит от этого выбора: он одинаков и при сквоше, и при добавлении миграций поверх.

**Правила выполнения (памятка):** Docker/Supabase живут в WSL, `npx supabase` их не видит — команды
идут через `wsl.exe -e bash -lc "docker exec ..."`. После каждой миграции — перегенерация
`src/lib/supabase/database.types.ts` (CLAUDE.md §3). `supabase db reset` — только против локальной БД.

---

## 5. Целевая карта модулей

```
src/lib/search/
  request.ts            ← НОВОЕ: UniversalVesselSearchRequest (бывш. criteria.ts, расширенный)
  offer.ts              ← НОВОЕ: UniversalVesselOffer (бывш. result.ts, + availability/confidence)
  vocabulary/
    vessel-types.ts     ← НОВОЕ: канонические типы + нормализация синонимов
    price-units.ts      ← НОВОЕ
  ranking.ts            ← + sourceConfidence, dataFreshness, availabilityConfidence
  dedupe.ts             ← + сигнатура судна для персистентной идентичности
  match-criteria.ts     ← + фильтры длины, кают, гео-радиуса
  geo.ts                ← НОВОЕ: haversine, bounding box для searchRadiusKm

src/server/search/
  orchestrator/
    search-orchestrator.ts   ← НОВОЕ: заменяет global-search-service.ts
    internal-first.ts        ← НОВОЕ: MIN_INTERNAL_RESULTS
    candidate-phase.ts       ← НОВОЕ: Phase 1 по индексу
    verification-phase.ts    ← НОВОЕ: Phase 2, TOP N, параллельно, с таймаутами
  adapters/
    adapter.ts               ← НОВОЕ: VesselSourceAdapter (Арх §10)
    internal-adapter.ts      ← обёртка над internal-provider.ts
    generic-adapter.ts       ← из providers/generic/
    brilions-adapter.ts      ← из providers/brilions/
    adapter-registry.ts      ← из provider-registry.ts, + coverage/capabilities предфильтр
  index/
    vessel-index.ts          ← НОВОЕ: чтение/запись external_vessel_index
    indexer.ts               ← НОВОЕ: фоновый обход источника → индекс
    identity.ts              ← НОВОЕ: logical vessel entity
  resilience/
    circuit-breaker.ts       ← НОВОЕ
    rate-limiter.ts          ← НОВОЕ
    source-health.ts         ← НОВОЕ
  intents/
    contact-intent.ts        ← НОВОЕ (Арх §20)
    message-generator.ts     ← НОВОЕ: AI-черновик сообщения
  crawl/ registry/           ← без изменений, новые потребители
  source-registry.ts         ← SourceProfile v2
  source-analyzer.ts         ← из source-validation.ts, расширенный (Арх §19)

src/app/api/cron/
  index-sources/route.ts        ← НОВОЕ: фоновый обход (Арх §12)
  refresh-availability/route.ts ← НОВОЕ (опционально, Э7)
  cleanup-search-index/route.ts ← существует, адаптируется
```

---

## 6. Этапы

Каждый этап — рабочее приложение на выходе (CLAUDE.md §10): `npm run build`, `npm run lint`,
`npm run typecheck`, `npm run test` проходят до перехода к следующему.

---

### Э0 — Подготовка (0.5 дня, без кода)

- Ответить на открытые вопросы §8.
- Зафиксировать решение по сквошу миграций.
- Снять baseline-метрики текущего поиска (`search_runs`: `execution_ms`, `ai_calls`,
  `external_results` за последние прогоны) — иначе после миграции нечем будет доказать выигрыш.
- Зафиксировать перечень активных источников и их конфигурацию (экспорт `search_sources`,
  `search_source_crawl_rules`, `search_source_urls`) — Э3 пересоздаёт `search_sources`, данные
  нужно перенести.

**Готово когда:** решения записаны, дамп конфигурации источников лежит в репозитории (без секретов).

---

### Э1 — Канонический словарь и типы судов (Арх §7)

Первым, потому что тип судна — это колонка `vessels.type`, enum БД, фильтр каталога, ключ i18n и
поле в каждом результате поиска. Любой более поздний порядок означает переделку.

**БД**
- Новый enum `vessel_type`: `MOTOR_YACHT, SAILING_YACHT, CATAMARAN, TRIMARAN, SUPERYACHT,
  EXPEDITION_YACHT, MOTOR_BOAT, SAILING_BOAT, OTHER`.
- Миграция `vessels.type` со старой картой: `yacht → MOTOR_YACHT` (значение по умолчанию, требует
  ручной ревизии существующих строк), `catamaran → CATAMARAN`, `expedition → EXPEDITION_YACHT`,
  `research → EXPEDITION_YACHT`, `hybrid → OTHER`. Отображение необратимо (`research` и
  `expedition` схлопываются) — если исследовательские суда должны остаться отдельным классом,
  канонический словарь Арх §7 нужно расширить своим значением `RESEARCH_VESSEL`. **Рекомендую
  расширить:** BRD §5 явно называет исследовательские суда отдельным продуктом.
- Новая таблица `vessel_type_aliases (alias text, vessel_type, source_id nullable, confidence)` —
  «Sailboat/Sailing/Sailing Yacht → SAILING_YACHT» как данные, не код (CLAUDE.md §9). Глобальные
  синонимы — `source_id is null`, сайт-специфичные — с привязкой.
- Аналогично `price_unit`: enum `HOUR|DAY|WEEK|MONTH|TRIP` (сейчас живёт только в TS).

**Код**
- `src/lib/search/vocabulary/vessel-types.ts`: `normalizeVesselType(raw, aliases)` — чистая
  функция, покрытая тестами; «не распознал» → `null`, никогда не `OTHER` по умолчанию (правило
  «absent beats invented», уже действующее в `criteria.ts`).
- Обновить: `src/lib/validation/search.ts`, `src/lib/validation/vessel.ts`, `internal-provider.ts`,
  `match-criteria.ts`, `interpret-fallback.ts`, `vocabulary.ts`, `query-interpreter.ts` (промпт),
  `providers/*/normalize.ts`.
- i18n: `messages/ru.json`, `messages/en.json` — ключи `vessels.types.*` под 9–10 значений.
- `supabase/seed.sql` — новые значения.

**Готово когда:** каталог `/search`, карточка судна, ЛК владельца и админка работают на новом
enum; `normalizeVesselType` покрыт тестами на реальных названиях с brilions и globesailor.

**Риск:** высокий по объёму (тип судна протекает в ~15 файлов), низкий по сложности.

---

### Э2 — `UniversalVesselSearchRequest` и `UniversalVesselOffer` (Арх §5, §6, §11)

**Код**
- `src/lib/search/request.ts` (переименование `criteria.ts` + расширение):
  добавить `location.latitude/longitude`, `searchRadiusKm`, `priceUnit`, `vesselTypes: VesselType[]`
  (вместо единственного `vesselType`), `lengthMin/lengthMax`, `crewType`, `captainRequired`,
  `amenities[]` и `activities[]` (разделить нынешний `features[]`).
  Сохранить дисциплину `orNull`: AI-вывод недоверенный, любое кривое поле → `null`.
- `src/lib/search/offer.ts` (переименование `result.ts` + расширение):
  `sourceId`, `externalId`, `availabilityStatus`, `confidence`, `indexedAt`, `verifiedAt`,
  `contactCapability`. Внутренние офферы получают `availabilityStatus: "VERIFIED"` по построению —
  их доступность мы знаем из своей БД.
- `src/lib/search/geo.ts`: haversine + bounding box (для `searchRadiusKm` и предфильтра coverage).
- Обновить промпт `query-interpreter.ts` под расширенную модель; расширить
  `interpret-fallback.ts` (детерминированный путь обязан оставаться рабочим без ключа).
- Обновить чипы (`criteriaToChips`) и `discover/page.tsx` под новые критерии.
- Обновить `ranking.ts`, `dedupe.ts`, `match-criteria.ts` под новые поля.

**БД:** `search_runs.interpreted_criteria` — JSONB, схема меняется без миграции. Добавить
`search_runs.request_version int` — чтобы старые прогоны не читались как новые.

**Готово когда:** запрос «яхта в 50 км от Сплита, 12–14 м, до 3000 EUR за неделю, с капитаном»
разбирается обоими интерпретаторами; все тесты `src/lib/search/*` зелёные.

**Риск:** самый дорогой рефакторинг плана по числу задетых тестов (~30 файлов). Делать одним
проходом, не размазывать.

---

### Э3 — Source Registry v2: SourceProfile, Coverage, Policies (Арх §8, §9, §24)

**БД (снос и пересоздание)**

```sql
drop table search_sources cascade;  -- вместе с зависимыми FK

create type search_access_strategy as enum
  ('API','GRAPHQL','STRUCTURED_DATA','SEARCH_URL','WEB_PARSER','AI_EXTRACTION');

create table search_sources (
  id, name, domain unique, base_url, enabled, status,
  priority, reliability_score,
  access_strategy search_access_strategy not null,       -- лестница Арх §8
  fallback_strategies search_access_strategy[],          -- порядок деградации
  -- capabilities (Арх §8)
  can_search, can_details, can_availability, can_pricing, can_contact boolean,
  -- search capabilities
  supports_location, supports_dates, supports_price, supports_guests boolean,
  contact_capability search_contact_capability,          -- Арх §20
  selector_config jsonb, image_domains text[],
  auto_select_classifications search_url_classification[],
  detailed_logging boolean,
  robots_allows boolean, last_checked_at timestamptz,
  ...
);

create table search_source_coverage (
  source_id, worldwide boolean, country text, region text, destination text,
  latitude, longitude, radius_km
);

create table search_source_policies (
  source_id primary key,
  access_policy jsonb,        -- robots, ToS-ссылка, требуется ли auth (запрещено обходить)
  cache_policy jsonb,         -- TTL: price / availability / metadata раздельно (Арх §22)
  attribution_policy jsonb,   -- обязательный текст/ссылка атрибуции
  rate_limit_policy jsonb,    -- rps, burst, окно
  retention_policy jsonb      -- сколько храним извлечённое
);
```

`search_contact_capability` enum: `EMAIL | PROVIDER_API | CONTACT_FORM | EXTERNAL_BOOKING_URL |
PLATFORM_MESSAGE | REDIRECT_ONLY` (Арх §20).

**Код**
- `source-registry.ts` → `SourceProfile` вместо плоского `SearchSource`.
- Новое: `coverage.ts` — `sourceCovers(profile, request)`: страна/регион/гео-радиус. Оркестратор
  спрашивает это **до** обращения к источнику (Арх §9).
- Админка `search-sources/`: форма расширяется секциями Capabilities, Coverage, Policies.
  Проверить, что список стран/регионов приходит из `locations`, а не хардкодится (CLAUDE.md §9).
- Перенос конфигурации источников из дампа Э0.

**Готово когда:** источник, покрывающий только Балтику, не опрашивается по запросу «Греция», и это
видно в `search_runs`; политики редактируются в админке.

---

### Э4 — `VesselSourceAdapter` (Арх §10)

**Код**
- `adapters/adapter.ts`:

```ts
export interface VesselSourceAdapter {
  readonly sourceId: string;
  supports(request: UniversalVesselSearchRequest): boolean;
  search(request: UniversalVesselSearchRequest, ctx: AdapterContext): Promise<AdapterSearchResponse>;
  getDetails(externalId: string, ctx: AdapterContext): Promise<VesselDetails | null>;
  checkAvailability(externalId: string, from: string, to: string, ctx: AdapterContext): Promise<AvailabilityResult>;
  getContactCapability(): ContactCapability;
}
```

  Контракт «никогда не бросает» сохраняется из `providers.ts` — он уже правильный и доказал себя.
- `internal-adapter.ts`: обёртка над `internal-provider.ts`. `checkAvailability` для него — не
  заглушка, а реальная проверка по `availability`/`bookings` (уже есть
  `get_vessels_booked_ranges`). `getContactCapability() → PLATFORM_MESSAGE`.
- `generic-adapter.ts`, `brilions-adapter.ts`: перенос существующих провайдеров.
  `checkAvailability` для сайтов без публичного календаря честно возвращает `UNKNOWN` — это
  предусмотренный Арх §15 исход, не недоделка.
- `adapter-registry.ts`: `provider-registry.ts` + предфильтр по `supports()`, coverage и
  capabilities.

**Готово когда:** оркестратор работает через единый список адаптеров, включая внутренний;
`getActiveExternalProviders` удалён.

---

### Э5 — External Vessel Index + фоновый индексатор (Арх §12)

Самый крупный этап. Именно он снимает live-crawl с пользовательского пути.

**БД**

```sql
create table external_vessel_index (
  id uuid primary key,
  source_id uuid not null references search_sources on delete cascade,
  external_id text not null,
  source_url text not null,
  name text, vessel_type vessel_type, vessel_type_raw text,
  manufacturer text, model text, year int, length_meters numeric,
  country text, region text, city text, marina text,
  latitude double precision, longitude double precision,
  price_from_minor int, price_to_minor int, currency text, price_unit price_unit,
  capacity int, cabins int,
  available_from date, available_to date,
  images jsonb, amenities text[],
  extracted jsonb not null,             -- полный UniversalVesselOffer
  field_provenance jsonb not null,
  content_hash text,
  indexed_at timestamptz not null,
  last_checked_at timestamptz not null,
  last_seen_at timestamptz not null,    -- «пропал с сайта»
  identity_id uuid references vessel_identities,
  unique (source_id, external_id)
);
-- индексы под строгие фильтры Арх §13: (country, city), vessel_type, capacity,
-- price_from_minor, last_seen_at, гео — bounding box по lat/lng (см. §8 п.4).
```

`search_extracted_listings` заменяется этой таблицей; `search_field_conflicts.listing_id`
переезжает на неё (логика `listing-merge.ts` сохраняется — она уже правильная).

**Код**
- `index/indexer.ts`: обход `search_source_urls where selected` (URL Registry уже готов и
  задуман ровно под это) → `cached-fetch` (условный GET, `ETag`/`If-Modified-Since` уже реализован)
  → extract (селекторы → JSON-LD → AI) → нормализация → upsert в индекс.
  AI-извлечение кэшируется **персистентно** по `content_hash` — тот `ExtractionCache`, который
  README до сих пор числит нереализованным.
- `src/app/api/cron/index-sources/route.ts`, защита секретом cron. Расписание: раз в 12–24 ч
  (каталоги чартеров меняются неделями). Плюс ручной запуск из админки источника.
- Стратегия «пропало»: не удалять сразу; исключать из выдачи после N обходов без попадания;
  физическое удаление — отдельным редким job'ом (переиспользовать `index-retention.ts`).
- Rate limit и вежливость обхода берутся из `search_source_policies`.

**Готово когда:** для зарегистрированного источника индекс наполняется полностью (а не выборкой),
и `select` по индексу возвращает те же суда, что live-crawl, — сверка на 2 источниках.

**Переходный период:** live-путь остаётся доступным как ручной инструмент сверки, но не
подключается в пользовательский поиск.

---

### Э6 — Search Orchestrator v2 (Арх §13, §14, §16, §26)

**Код**
- `orchestrator/search-orchestrator.ts` заменяет `global-search-service.ts`. Алгоритм — по
  Арх §26, буквально:
  1. request → internal adapter → строгие фильтры;
  2. `internalResults >= MIN_INTERNAL_RESULTS` → ранжировать и вернуть (внешний контур не
     запускается; пользователь может запросить его явно);
  3. иначе Phase 1: `external_vessel_index` → строгие фильтры (место, даты, цена, вместимость) →
     merge с внутренними → дедуп → ранжирование → **TOP N**;
  4. Phase 2: `checkAvailability`/`getDetails` только для TOP N, параллельно, с per-adapter
     таймаутом и ограничением concurrency;
  5. обновить price/availability/freshness/confidence, выбросить `UNAVAILABLE`;
  6. финальное ранжирование → выдача.
- `MIN_INTERNAL_RESULTS` — в `platform_settings` (таблица уже есть), не константа в коде.
- Курсорная пагинация (CLAUDE.md §9): курсор `(score, id)`, base64, непрозрачный. Ставится
  **после** дедупа и ранжирования — иначе одно судно из двух источников разъедется по страницам.
  Переиспользовать подход `lib/search/vessel-cursor.ts`, но отдельным модулем: там keyset по
  колонке БД, здесь — по вычисленному score.
- `search_runs`: добавить `candidates_from_index`, `live_verifications`, `verification_failures`,
  `internal_first_short_circuit boolean`.
- UI `discover/`: секция внутренних результатов + явная кнопка «Искать во внешних источниках»
  когда сработал Internal First; «Показать ещё» / infinite scroll на курсоре.

**Готово когда:** поиск с достаточным внутренним покрытием не делает ни одного внешнего HTTP-
запроса; поиск с недостаточным укладывается в бюджет и показывает, сколько кандидатов
верифицировано вживую.

---

### Э7 — Availability, Confidence, Freshness (Арх §15)

**БД:** enum `availability_status` (`VERIFIED|LIKELY_AVAILABLE|UNKNOWN|UNAVAILABLE`),
enum `data_confidence` (`HIGH|MEDIUM|LOW`). Колонки в `external_vessel_index` и в оффере.

**Код**
- Правила вывода: свежесть индекса + результат live-верификации + `reliability_score` источника →
  `availabilityStatus` и `confidence`. Чистая функция с тестами, не эвристика внутри UI.
- `result-card.tsx`: **запрет** показывать индексированную цену/доступность как подтверждённую
  (Арх §15 прямо это требует). Разные визуальные состояния: «проверено сейчас» / «по данным
  каталога на <дата>» / «доступность неизвестна».
- Раздельные TTL: price, availability, metadata (из `cache_policy`).
- Опциональный cron `refresh-availability` для источников с `can_availability = true`.

**Готово когда:** ни один внешний результат в UI не утверждает доступность, которую мы не
проверяли; дата индексации видна пользователю.

---

### Э8 — Отказоустойчивость (Арх §22, §23)

**БД:** `search_source_health (source_id, state, consecutive_failures, last_success_at,
last_failure_at, last_error, opened_at)`.

**Код**
- `resilience/circuit-breaker.ts`: closed → open → half-open, порог и cooldown из политики
  источника. Открытый breaker означает «отдаём индексированные данные с понижением confidence»,
  а не «ошибка поиска».
- `resilience/rate-limiter.ts`: по `rate_limit_policy`, общий для индексатора и live-верификации.
- Метрики ошибок в `search_runs` + страница здоровья источников в админке.
- Правило Арх §23 «ошибка одного сайта не ломает поиск» уже соблюдается через `Promise.allSettled`
  — сохранить и покрыть тестом на регресс.

---

### Э9 — Contact Intent / Booking Intent (Арх §20)

**БД**

```sql
create type intent_type as enum ('CONTACT_REQUEST','BOOKING_REQUEST','INFO_REQUEST');
create type intent_status as enum ('DRAFT','CONFIRMED','SENT','ANSWERED','FAILED','CANCELLED');

create table contact_intents (
  id, user_id references profiles, source_id references search_sources,
  external_vessel_id text, index_id references external_vessel_index,
  type intent_type, status intent_status default 'DRAFT',
  date_from date, date_to date, guests int,
  message_draft text, message_sent text,
  contact_capability search_contact_capability,
  delivery_channel text, delivery_reference text,
  created_at, confirmed_at, sent_at
);
```

RLS: пользователь видит только свои интенты; админ — все.

**Код**
- `intents/contact-intent.ts` — Server Actions: создать черновик → показать → подтвердить →
  отправить/редиректнуть, по ветке `ContactCapability`.
- `intents/message-generator.ts` — AI-черновик письма владельцу/провайдеру (Арх §18 п.7).
  **Отправка только после явного подтверждения пользователем** (Арх §20) — не автоматически.
- Для `REDIRECT_ONLY` интент фиксирует факт перехода и не притворяется отправкой.
- Для `PLATFORM_MESSAGE` (внутренние суда) — существующие `conversations`/`messages`.
- UI: на карточке внешнего результата — «Запросить у поставщика» вместо мнимой брони.

**Ценность сверх функции:** Арх §27 прямо называет это каналом расширения собственного каталога —
интент к внешнему владельцу это ещё и лид на подключение его к платформе.

---

### Э10 — Source Onboarding v2 (Арх §19)

**Код**
- `source-analyzer.ts` из `source-validation.ts` + новое: детект REST API и GraphQL-эндпоинтов,
  анализ URL поисковой формы, анализ структуры HTML, AI-анализ как последняя ступень.
- Выход — **готовый черновик `SourceProfile`** (стратегия, capabilities, coverage, предложенные
  crawl-rules и селекторы), который админ правит и одобряет. Сейчас админ вводит почти всё руками.
- Детект смены структуры источника: при падении доли успешных извлечений ниже порога — пометить
  источник и предложить переанализ. AI на онбординге и при поломке, не на каждом запросе (Арх §18).

---

### Э11 — AI-слой поверх детерминированного (Арх §16, §17)

- `vessel_identities` + `vessel_identity_offers`: одно логическое судно — много офферов из разных
  источников (Арх §17). Дедупликация становится персистентной, а не пересчитывается на каждый
  запрос; сложные случаи разрешает AI, простые — существующая `dedupe.ts`.
- Semantic ranking: AI переупорядочивает **только** уже отфильтрованный TOP N по мягким
  предпочтениям («тихая семейная яхта для отдыха с детьми»). Строгие условия (цена, даты,
  вместимость) остаются детерминированными — Арх §16 это прямо запрещает отдавать модели.
- Оба шага — опциональные: без `ANTHROPIC_API_KEY` система обязана продолжать работать (текущее
  свойство, терять его нельзя).

---

## 7. Порядок и зависимости

```
Э0 ──► Э1 ──► Э2 ──┬──► Э3 ──► Э4 ──► Э5 ──► Э6 ──┬──► Э7 ──► Э8
                   │                              ├──► Э9
                   └──────────────────────────────┴──► Э10 ──► Э11
```

- Э1 и Э2 — фундамент, распараллеливанию не подлежат.
- Э3 и Э4 формально независимы (разные файлы), но Э4 нужен `SourceProfile` из Э3 для предфильтра —
  практичнее последовательно.
- Э5 — единственный этап, где стоит держать переходный период с сохранённым live-путём.
- Э9 и Э10 независимы от Э7/Э8 и могут идти раньше, если приоритет — продуктовая ценность.

Ориентировочный объём (один разработчик, включая тесты и живую проверку):
Э1 ~2 дня · Э2 ~3 дня · Э3 ~2 дня · Э4 ~2 дня · Э5 ~4 дня · Э6 ~4 дня · Э7 ~2 дня · Э8 ~2 дня ·
Э9 ~3 дня · Э10 ~3 дня · Э11 ~3 дня. Итого ~30 рабочих дней. Первые шесть этапов (~17 дней) дают
работающую целевую архитектуру; остальное — её дозревание.

---

## 8. Открытые вопросы (нужны решения до Э1)

1. **Прод-данные.** Есть ли в удалённой Supabase данные, которые нельзя терять? От этого зависит,
   сквошим ли мы миграции в новый baseline или наращиваем поверх.
2. **`RESEARCH_VESSEL`.** Канонический словарь Арх §7 не содержит исследовательских судов, а
   BRD §5 делает на них ставку. Расширяем словарь своим значением (рекомендую) или схлопываем в
   `EXPEDITION_YACHT`?
3. **`MIN_INTERNAL_RESULTS`.** Арх приводит 3 как пример. При нынешнем каталоге (4 опубликованных
   судна в seed) любое значение ≥3 практически всегда будет отсекать внешний поиск. Предлагаю
   стартовать с 3, но держать в `platform_settings` и не включать short-circuit, пока каталог мал.
4. **Гео.** Включать PostGIS ради `searchRadiusKm` или обойтись bounding box + haversine?
   Рекомендую второе: одна зависимость меньше, точности для радиуса поиска хватает.
5. **Частота индексации и её стоимость.** Полный обход источника с AI-извлечением каждой новой
   страницы — основная статья расходов на модель. Нужен потолок AI-вызовов на прогон индексатора.
6. **Юридический контур.** `AccessPolicy`/ToS каждого источника заполняет человек — Арх §24 не
   позволяет это автоматизировать. Нужен ответственный и процедура.
7. **Судьба `providers/brilions/`.** Сайт-специфичный провайдер остаётся как эталон точности или
   сворачивается в generic + `selector_config`? Рекомендую оставить: он единственный источник, на
   котором проверялась полнота извлечения.

---

## 9. Что удаляется

| Удаляется | Заменяется на | Этап |
|---|---|---|
| `src/server/search/global-search-service.ts` | `orchestrator/search-orchestrator.ts` | Э6 |
| `src/server/search/providers.ts` (`ExternalSearchProvider`) | `adapters/adapter.ts` | Э4 |
| `src/server/search/provider-registry.ts` | `adapters/adapter-registry.ts` | Э4 |
| таблица `search_extracted_listings` | `external_vessel_index` | Э5 |
| enum `search_processing_type` | `search_access_strategy` | Э3 |
| enum `vessel_type` (5 значений) | канонический словарь (9–10) | Э1 |
| live-crawl в пользовательском пути (`providers/generic/provider.ts`, `buildRunSearch`) | индекс + live-верификация TOP N | Э5/Э6 |
| `src/server/search/EXTERNAL_SEARCH_INDEXING_PLAN.md` | этот документ (поглощает его целиком) | Э5 |

Не удаляется ничего из `crawl/`, `registry/url-*`, `source-breadcrumbs`, `search_page_cache`,
`api/external-image/`, `listing-merge.ts` — этот слой спроектирован верно и переиспользуется.

---

## 10. Как проверять

- **Тесты:** каждый этап начинается с обновления/дописывания unit-тестов чистых функций
  (`src/lib/search/`), затем — реализация. Формула ранжирования и правила availability меняются
  только через тест (CLAUDE.md §7).
- **Живая проверка:** после Э5 и Э6 — прогон на 2 реальных источниках с фиксацией в
  `src/server/search/README.md` (тот же формат «Что проверено вживую», который уже ведётся, — он
  себя оправдал: три реальных бага найдены именно так).
- **Регресс производительности:** сравнение `search_runs` до/после против baseline из Э0.
  Целевые числа — BRD §8: ответ поиска ≤ 1 с (внутренняя фаза), LCP ≤ 2 с.
- **E2E:** `npm run test:e2e` на сценариях discover — внутренний результат, внешний результат,
  Internal First short-circuit, создание Contact Intent.
