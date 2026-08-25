# SEO, Web Discovery & JSON-LD — Project Rules

## 0. Область документа

Документ объединяет проектную логику, обсуждавшуюся по темам **SEO, sitemap.xml, Web Discovery, crawling, сайты без SEO, JSON-LD, извлечение данных, AI extraction, индексирование и безопасность**.

Цель — построить Web Discovery & Extraction Engine, который умеет получать данные с разрешённых публичных источников независимо от качества SEO сайта, нормализовать их во внутреннюю модель и использовать локальный индекс для быстрого пользовательского поиска.

---

## 1. SEO как источник данных

SEO не должно быть обязательным условием работы системы. Оно рассматривается как один из способов быстро обнаружить и понять содержимое сайта.

Полезные SEO-источники:

- `robots.txt`;
- `sitemap.xml` и sitemap index;
- canonical URL;
- `title`;
- meta description;
- OpenGraph;
- Schema.org;
- JSON-LD;
- headings;
- внутренние ссылки.

При наличии структурированных данных система должна использовать их раньше полного HTML parsing и AI.

---

## 2. Sitemap-first discovery

Первый предпочтительный путь обнаружения страниц:

```text
Site
 |
 v
robots.txt
 |
 v
Sitemap discovery
 |
 v
sitemap.xml / sitemap index
 |
 v
URL extraction
 |
 v
URL classification
 |
 v
Priority Queue
```

`sitemap.xml` является **источником обнаружения URL**, но не доверенным источником бизнес-фактов.

`lastmod` используется как подсказка для планирования повторного обхода, но не должен безусловно считаться доказательством изменения страницы.

Для больших sitemap необходимо поддерживать sitemap index и потоковую/пакетную обработку URL.

---

## 3. Приоритизация URL для vessel/expedition domain

Пример начальных приоритетов:

```text
/boat/...          P0
/yacht/...         P0
/vessel/...        P0
/charter/...       P1
/fleet/...         P1
/expedition/...    P1
/destination/...   P2
/blog/...          P3
/about/...         P3
/contact/...       P3
/login/...         IGNORE
/account/...       IGNORE
```

Приоритеты должны быть конфигурируемыми для каждого зарегистрированного сайта.

---

## 4. Как ускорить SEO/Web Discovery

Главное правило производительности:

> Пользовательский запрос не должен каждый раз запускать повторное чтение всего Интернета.

Использовать:

- incremental crawling;
- URL priority queue;
- per-domain concurrency;
- rate limiting;
- HTTP caching;
- `ETag`;
- `Last-Modified`;
- content hash;
- Raw Page Cache;
- Parsed Data Cache;
- Structured Data Cache;
- AI Extraction Cache;
- локальный Search Index.

Основная модель:

```text
Internet
   |
   v
Discovery/Crawling
   |
   v
Extraction
   |
   v
Normalization
   |
   v
Database / Search Index
   |
   v
User Search
```

При пользовательском запросе поиск сначала выполняется по локальному индексу. В сеть система обращается только для discovery, refresh, freshness check или если локальных данных недостаточно.

---

## 5. Сайты без SEO

Отсутствие `sitemap.xml`, JSON-LD, Schema.org или качественных meta tags не означает, что публичный сайт нельзя обработать.

Используется HTML Discovery:

```text
Homepage
 |
 v
Extract <a href>
 |
 v
Normalize URLs
 |
 v
Classify URLs
 |
 v
Select relevant URLs
 |
 v
Crawl
 |
 v
Content Extraction
```

Таким образом SEO является ускорителем discovery, а не обязательной зависимостью.

---

## 6. Сайты, где crawling ограничен

Перед crawling необходимо проверить правила сайта.

Если доступ для crawler запрещён:

```text
crawl_status = BLOCKED_BY_ROBOTS
```

Система не должна пытаться обходить:

- authentication;
- CAPTCHA;
- access-control;
- технические блокировки;
- ограничения, предназначенные для предотвращения автоматического доступа.

`robots.txt` рассматривается как правило crawling, а не как механизм авторизации или источник данных.

---

## 7. HTML Content Extraction

После получения HTML:

```text
HTML
 |
 +--> JSON-LD
 +--> Microdata
 +--> OpenGraph
 +--> Meta
 +--> Main Content
 +--> Links
```

Перед AI из основного контента следует по возможности удалить:

```text
script
style
navigation
footer
cookie banners
advertising
repeated layout
irrelevant widgets
```

AI не должен получать полный сырой HTML, если нужные данные можно извлечь дешевле детерминированными средствами.

---

## 8. JavaScript-rendered сайты

Если HTTP HTML не содержит полезного содержимого:

```text
HTTP Fetch
 |
 v
Useful content?
 |
 +-- YES --> Extract
 |
 +-- NO --> Headless Browser
              |
              v
          Render JavaScript
              |
              v
           DOM Snapshot
              |
              v
            Extract
```

Browser rendering является fallback и должен применяться только при необходимости из-за более высокой стоимости.

---

## 9. Автоматический выбор способа обработки сайта

```text
AUTO
 |
 +--> Public/Official API available?
 |       +--> API
 |
 +--> Sitemap available?
 |       +--> SITEMAP
 |
 +--> Useful server HTML?
 |       +--> HTML
 |
 +--> JS-rendered content?
 |       +--> BROWSER
 |
 +--> otherwise
         UNSUPPORTED / MANUAL_REVIEW
```

В Site Registry рекомендуется хранить выбранный режим обработки:

```text
API
SITEMAP
HTML
BROWSER
AUTO
DISABLED
```

---

## 10. Unified extraction pipeline

```text
                SITE REGISTRY
                     |
                     v
               Access Policy
                     |
                     v
                 Discovery
          +----------+----------+
          |          |          |
         API      Sitemap    HTML Links
          |          |          |
          +----------+----------+
                     |
                     v
                  URL Queue
                     |
                     v
                 HTTP Fetch
                     |
                     v
             Content Detection
                     |
       +-------------+-------------+
       |             |             |
      API         JSON-LD         HTML
       |             |             |
       |             |       +-----+------+
       |             |       |            |
       |             |    Structured    Main Text
       |             |    Extractors       |
       |             |                     |
       |             |                  AI only
       |             |                if required
       +-------------+----------+----------+
                              |
                              v
                          Normalizer
                              |
                              v
                           Validator
                              |
                              v
                          Data Merger
                              |
                              v
                       Conflict Detector
                              |
                              v
                     Unified Domain Model
                              |
                              v
                         PostgreSQL
                              |
                              v
                         Search Index
```

---

## 11. Внутренняя модель источника

Для каждого извлечённого объекта необходимо сохранять происхождение:

```json
{
  "siteId": 15,
  "sourceUrl": "https://example.com/yachts/aurora",
  "httpContentType": "text/html",
  "extractionSource": "JSON_LD",
  "mediaType": "application/ld+json",
  "retrievedAt": "2026-08-25T08:20:00Z",
  "contentHash": "...",
  "confidence": 0.98
}
```

Для важных полей желательно сохранять provenance на уровне значения.

---

## 12. Пример пользовательского поиска

```text
"Нужно судно для экспедиции на Шпицберген
в июле, 6–10 человек, до EUR 20 000"
```

AI Query Parser:

```json
{
  "destination": "Svalbard",
  "month": "July",
  "passengersMin": 6,
  "passengersMax": 10,
  "budgetMax": 20000,
  "currency": "EUR",
  "purpose": "expedition"
}
```

Дальше:

```text
Natural Language
      |
      v
AI Query Parser
      |
      v
Internal Search Query
      |
      v
Local Search Index
      |
      v
Candidates
      |
      v
Freshness Check
      |
      v
Selective URL Refresh
      |
      v
Ranking
      |
      v
Answer + Source URLs
```

AI здесь интерпретирует запрос и формирует итоговый ответ, но не должен повторно crawling-овать весь Интернет.

---

## 25. JSON-LD: назначение

Этот документ определяет правила работы проекта с JSON-LD и другими источниками структурированных данных при анализе внешних веб-сайтов.

Цель логики:

- ускорить обработку веб-страниц;
- минимизировать количество вызовов AI/LLM;
- извлекать структурированные данные до анализа HTML через AI;
- поддерживать сайты с хорошим SEO, плохим SEO или без SEO;
- унифицировать данные из JSON-LD, HTML, API и других источников;
- сохранять источник каждого полученного значения;
- обнаруживать конфликты между разными источниками данных;
- не выполнять обход ограничений доступа сайта.

---

## 14. Основной принцип

JSON-LD не является отдельным поисковым запросом.

В типичном случае система выполняет обычный HTTP-запрос страницы:

```http
GET /yachts/aurora HTTP/1.1
Host: example.com
Accept: text/html
```

Сервер возвращает HTML:

```http
HTTP/1.1 200 OK
Content-Type: text/html; charset=utf-8
```

Внутри HTML может находиться:

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Product",
  "name": "Aurora Explorer"
}
</script>
```

Следовательно:

```text
HTTP Content-Type страницы = text/html
JSON-LD media type          = application/ld+json
```

Эти значения нельзя смешивать.

---

## 15. Content-Type

### 3.1 HTML-страница с JSON-LD

Типичный HTTP-ответ:

```http
Content-Type: text/html; charset=utf-8
```

JSON-LD определяется внутри HTML по:

```html
<script type="application/ld+json">
```

Внутренняя модель:

```json
{
  "httpContentType": "text/html",
  "dataFormat": "JSON_LD",
  "mediaType": "application/ld+json"
}
```

### 3.2 Отдельный JSON-LD ресурс

Если JSON-LD возвращается непосредственно HTTP-ресурсом:

```http
Content-Type: application/ld+json
```

Такой ответ должен передаваться непосредственно JSON-LD parser-у без HTML parsing.

### 3.3 Обычный JSON API

Не путать:

```http
Content-Type: application/json
```

с:

```http
Content-Type: application/ld+json
```

`application/json` обычно означает обычный JSON API.

`application/ld+json` означает JSON-LD.

---

## 16. Приоритет источников данных

Рекомендуемый порядок обработки:

```text
1. Official/Public API
2. JSON-LD / Schema.org
3. Microdata
4. OpenGraph / Meta
5. Deterministic HTML extraction
6. JavaScript rendered HTML
7. AI extraction
8. Inference
```

AI не должен использоваться, если необходимые данные уже надежно получены из структурированного источника.

---

## 17. Общий pipeline

```text
Site
  |
  v
robots.txt check
  |
  v
Discovery
  |
  +--> API
  |
  +--> sitemap.xml
  |
  +--> HTML link discovery
          |
          v
         URL
          |
          v
      HTTP Fetch
          |
          v
       Response
          |
          +--> Content-Type detection
          |
          +--> JSON-LD extraction
          |
          +--> Meta / OpenGraph
          |
          +--> HTML extraction
          |
          +--> Browser rendering if required
          |
          +--> AI extraction if required
                    |
                    v
                Normalizer
                    |
                    v
                Validator
                    |
                    v
                Data Merger
                    |
                    v
             Unified Domain Model
                    |
                    v
                 Database
                    |
                    v
               Search Index
```

---

## 18. Алгоритм обработки HTTP-ответа

### 6.1 Определить HTTP Content-Type

Пример:

```text
text/html
application/json
application/ld+json
application/xml
text/xml
```

### 6.2 Маршрутизация

```text
if Content-Type == application/ld+json:
    JSON-LD Parser

else if Content-Type == application/json:
    JSON/API Parser

else if Content-Type == text/html:
    HTML Parser
    -> JSON-LD discovery
    -> OpenGraph
    -> Meta
    -> HTML content extraction

else if Content-Type is XML:
    XML/Sitemap Parser

else:
    Unsupported or Generic Handler
```

---

## 19. Поиск JSON-LD внутри HTML

Для HTML необходимо найти все элементы:

```css
script[type="application/ld+json"]
```

Нельзя обрабатывать только первый блок.

Пример страницы:

```html
<script type="application/ld+json">
{
  "@type": "Organization"
}
</script>

<script type="application/ld+json">
{
  "@type": "Product"
}
</script>

<script type="application/ld+json">
{
  "@type": "BreadcrumbList"
}
</script>
```

Все три блока должны быть прочитаны и проанализированы.

---

## 20. Поддерживаемые формы JSON-LD

Parser должен поддерживать:

### 8.1 Одиночный объект

```json
{
  "@context": "https://schema.org",
  "@type": "Product",
  "name": "Aurora"
}
```

### 8.2 Массив

```json
[
  {
    "@type": "Organization"
  },
  {
    "@type": "Product"
  }
]
```

### 8.3 `@graph`

```json
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://example.com/#company"
    },
    {
      "@type": "Product",
      "@id": "https://example.com/yachts/aurora#product"
    }
  ]
}
```

### 8.4 Вложенные объекты

```json
{
  "@type": "Product",
  "offers": {
    "@type": "Offer",
    "price": "9500",
    "priceCurrency": "EUR"
  }
}
```

### 8.5 Ссылки через `@id`

```json
{
  "@id": "https://example.com/#company"
}
```

Parser должен уметь связывать сущности внутри одного JSON-LD документа, если это необходимо.

---

## 21. Основные специальные поля JSON-LD

### `@context`

Определяет используемый словарь.

Обычно:

```json
{
  "@context": "https://schema.org"
}
```

### `@type`

Определяет тип сущности.

Пример:

```json
{
  "@type": "Product"
}
```

Также может быть массивом:

```json
{
  "@type": ["Product", "Service"]
}
```

### `@id`

Идентификатор сущности:

```json
{
  "@id": "https://example.com/#organization"
}
```

### `@graph`

Содержит набор связанных сущностей.

---

## 22. Schema.org типы, полезные для проекта

Особое внимание рекомендуется уделять:

```text
Product
Offer
Service
Organization
Place
TouristTrip
Event
ImageObject
AggregateRating
BreadcrumbList
WebPage
ItemList
```

Для поиска судов особенно интересны:

```text
Product
Offer
Service
Place
Organization
TouristTrip
```

---

## 23. Пример JSON-LD для судна

```json
{
  "@context": "https://schema.org",
  "@type": "Product",
  "name": "Ocean Explorer",
  "description": "Expedition vessel",
  "image": [
    "https://example.com/images/ocean.jpg"
  ],
  "offers": {
    "@type": "Offer",
    "price": "12500",
    "priceCurrency": "EUR",
    "availability": "https://schema.org/InStock",
    "url": "https://example.com/ocean-explorer"
  }
}
```

Возможный результат:

```json
{
  "name": "Ocean Explorer",
  "description": "Expedition vessel",
  "price": 12500,
  "currency": "EUR",
  "availability": "InStock",
  "image": "https://example.com/images/ocean.jpg",
  "sourceUrl": "https://example.com/ocean-explorer"
}
```

---

## 24. Промежуточная модель

Нельзя напрямую связывать JSON-LD с финальной доменной сущностью.

Рекомендуемая схема:

```text
JSON-LD
  |
  v
RawStructuredData
  |
  v
Schema Mapper
  |
  v
Domain Candidate
  |
  v
Validation
  |
  v
Unified Domain Model
```

Пример:

```json
{
  "source": {
    "siteId": 15,
    "url": "https://example.com/yachts/aurora",
    "retrievedAt": "2026-08-25T08:20:00Z"
  },
  "format": "JSON_LD",
  "mediaType": "application/ld+json",
  "schemaType": "Product",
  "data": {
    "name": "Aurora Explorer",
    "description": "Expedition yacht",
    "price": 9500,
    "currency": "EUR"
  }
}
```

---

## 25. Объединение нескольких источников

JSON-LD может быть неполным.

Например:

```json
{
  "@type": "Product",
  "name": "Aurora",
  "description": "Luxury expedition vessel"
}
```

HTML страницы:

```text
Capacity: 12 guests
Cabins: 6
From €9,500/week
Location: Tromsø, Norway
```

Результат должен собираться из нескольких источников:

```text
JSON-LD
  -> name
  -> description

HTML parser
  -> capacity
  -> cabins

AI extractor
  -> price period
  -> location normalization

        |
        v
    Data Merger
        |
        v
 Unified Vessel
```

---

## 26. Приоритет и confidence

Каждое поле должно иметь источник и confidence.

Пример:

```json
{
  "price": {
    "value": 9500,
    "currency": "EUR",
    "source": "JSON_LD",
    "sourceUrl": "https://example.com/yachts/aurora",
    "confidence": 0.98
  }
}
```

Рекомендуемая начальная модель доверия:

```text
Official API          HIGH
JSON-LD               HIGH
HTML deterministic    MEDIUM/HIGH
AI extraction         MEDIUM
Inference             LOW
```

Значения confidence должны быть настраиваемыми.

---

## 27. Проверка конфликтов

JSON-LD нельзя считать абсолютной истиной.

Пример:

```text
JSON-LD price = 8000 EUR
HTML price    = 11000 EUR
```

Система не должна молча выбирать одно значение.

Нужно создать конфликт:

```json
{
  "type": "PRICE_CONFLICT",
  "jsonLdValue": 8000,
  "htmlValue": 11000,
  "currency": "EUR"
}
```

После этого:

- снизить confidence;
- сохранить оба источника;
- при необходимости использовать более свежий источник;
- передать конфликт AI только если deterministic rules не позволяют решить его.

---

## 28. Ошибки JSON-LD

В реальных сайтах возможны:

- invalid JSON;
- неправильный `@type`;
- старые цены;
- устаревшие Offer;
- дубли;
- несколько Product на странице;
- пустые поля;
- некорректный `@graph`;
- конфликт с HTML;
- неправильный Content-Type;
- schema.org данные, не относящиеся к основному содержимому страницы.

Обработка должна быть fault-tolerant.

Ошибка одного JSON-LD блока не должна останавливать обработку всей страницы.

---

## 29. Fallback-логика

```text
JSON-LD exists?
   |
   +-- YES --> Parse
   |            |
   |            v
   |         Enough data?
   |            |
   |        +---+---+
   |        |       |
   |       YES      NO
   |        |       |
   |        v       v
   |     Validate   HTML extraction
   |                |
   |                v
   |             AI if required
   |
   +-- NO --> HTML extraction
               |
               v
        Useful data found?
               |
          +----+----+
          |         |
         YES        NO
          |         |
          v         v
       Normalize  Browser render
                    |
                    v
                 AI if required
```

---

## 30. Java/Spring рекомендации

Константа:

```java
public static final String JSON_LD_MEDIA_TYPE =
        "application/ld+json";
```

Spring:

```java
MediaType jsonLd =
        MediaType.parseMediaType("application/ld+json");
```

Извлечение JSON-LD через Jsoup:

```java
Document document = Jsoup.parse(html);

Elements blocks =
        document.select("script[type=application/ld+json]");

for (Element block : blocks) {
    String json = block.data();

    try {
        JsonNode root = objectMapper.readTree(json);
        processJsonLd(root);
    } catch (Exception e) {
        // log error and continue with next block
    }
}
```

Пример рекурсивной обработки:

```java
void processJsonLd(JsonNode node) {

    if (node == null || node.isNull()) {
        return;
    }

    if (node.isArray()) {
        node.forEach(this::processJsonLd);
        return;
    }

    if (node.has("@graph")) {
        processJsonLd(node.get("@graph"));
    }

    if (node.has("@type")) {
        processEntity(node);
    }
}
```

---

## 31. Предлагаемые компоненты

```text
ContentTypeDetector
HttpFetcher
HtmlParser
JsonLdExtractor
JsonLdParser
SchemaOrgMapper
OpenGraphExtractor
MetaExtractor
HtmlContentExtractor
BrowserRenderer
AiExtractor
DataNormalizer
DataValidator
DataMerger
ConflictDetector
ConfidenceCalculator
SearchIndexer
```

Ответственность должна быть разделена.

`JsonLdExtractor` не должен:

- выполнять HTTP;
- принимать решения о crawling;
- вызывать AI;
- сохранять финальную Vessel-сущность.

---

## 32. Предлагаемые enum

```java
public enum DataFormat {
    JSON,
    JSON_LD,
    HTML,
    XML,
    SITEMAP,
    OPEN_GRAPH,
    MICRODATA,
    TEXT,
    UNKNOWN
}
```

```java
public enum ExtractionSource {
    API,
    JSON_LD,
    MICRODATA,
    OPEN_GRAPH,
    HTML,
    BROWSER_RENDERED_HTML,
    AI,
    INFERENCE
}
```

---

## 33. Правила использования AI

AI вызывается только если:

1. структурированных данных недостаточно;
2. HTML содержит полезные данные, которые трудно извлечь правилами;
3. необходимо нормализовать свободный текст;
4. существует конфликт данных, который невозможно разрешить deterministic rules;
5. требуется классификация содержимого.

AI не должен использоваться для:

- простого чтения JSON-LD;
- чтения цены из корректного Offer;
- чтения `@type`;
- чтения currency;
- парсинга корректного JSON;
- повторного анализа уже нормализованных данных.

---

## 34. Работа с сайтами без SEO

Отсутствие:

```text
sitemap.xml
JSON-LD
Schema.org
OpenGraph
meta description
```

не делает сайт неподдерживаемым.

Fallback:

```text
Homepage
  |
  v
HTML link discovery
  |
  v
URL classification
  |
  v
Relevant page
  |
  v
HTML extraction
  |
  v
Browser rendering if required
  |
  v
AI extraction
```

---

## 35. Работа с JavaScript сайтами

Если первоначальный HTML практически пуст:

```html
<div id="root"></div>
<script src="/app.js"></script>
```

и полезный DOM появляется после JavaScript:

```text
HTTP Fetch
  |
  v
Useful content exists?
  |
  +-- YES --> parse
  |
  +-- NO --> Browser Renderer
               |
               v
           rendered DOM
               |
               v
        structured extraction
```

В качестве browser engine можно использовать Playwright.

---

## 36. Безопасность и ограничения

Система обязана:

- проверять `robots.txt`;
- соблюдать ограничения crawling;
- не обходить authentication;
- не обходить CAPTCHA;
- не обходить технические ограничения доступа;
- не использовать методы сокрытия crawler;
- ограничивать частоту запросов;
- использовать per-domain rate limiting;
- предотвращать SSRF;
- запрещать доступ crawler к localhost и внутренним сетям;
- проверять redirects;
- ограничивать размер HTTP-ответов;
- ограничивать время обработки страницы.

Пример:

```text
crawl_status = BLOCKED_BY_ROBOTS
```

Если ресурс запрещен для crawler, система должна завершить обработку URL.

---

## 37. Кэширование

Для ускорения рекомендуется хранить:

```text
Raw Page Cache
Parsed Data Cache
JSON-LD Cache
AI Extraction Cache
Normalized Data Cache
```

Повторный AI-анализ страницы не нужен, если content hash не изменился.

---

## 38. Change Detection

Для каждой страницы сохранять:

```text
URL
ETag
Last-Modified
contentHash
fetchedAt
parsedAt
```

Перед полной повторной обработкой использовать:

```http
If-None-Match
If-Modified-Since
```

Если сервер возвращает:

```http
304 Not Modified
```

повторный parsing и AI extraction выполнять не нужно.

---

## 39. Правило архитектуры

Основной принцип проекта:

> Structured First, AI Last.

То есть:

```text
API
 -> JSON-LD
 -> Microdata
 -> OpenGraph
 -> HTML
 -> Browser Rendering
 -> AI
```

AI является fallback и semantic layer, а не основным механизмом парсинга сайта.

---

## 40. Итоговая архитектура

```text
                 WEB DISCOVERY ENGINE

                         Site
                          |
            +-------------+-------------+
            |             |             |
           API         Sitemap        HTML
            |             |             |
            |             |        Link Discovery
            |             |             |
            +-------------+-------------+
                          |
                          v
                       URL Queue
                          |
                          v
                      HTTP Fetch
                          |
                          v
                  ContentTypeDetector
                          |
            +-------------+-------------+
            |             |             |
        JSON/API         HTML       JSON-LD direct
            |             |             |
            |      +------+------+      |
            |      |             |      |
            |   JSON-LD        HTML     |
            |   Extractor    Extractor  |
            |      |             |      |
            |      |        Browser/AI  |
            |      |             |      |
            +------+------+------+------+
                   |
                   v
                Normalizer
                   |
                   v
                Validator
                   |
                   v
               Data Merger
                   |
                   v
             Conflict Detector
                   |
                   v
           Unified Domain Model
                   |
                   v
               PostgreSQL
                   |
                   v
               Search Index
```

---

## 41. Ключевые проектные правила

1. JSON-LD media type: `application/ld+json`.
2. HTML-страница с JSON-LD обычно имеет HTTP Content-Type `text/html`.
3. Не путать JSON-LD с `application/json`.
4. Обрабатывать все JSON-LD блоки страницы.
5. Поддерживать object, array, `@graph`, nested objects и `@id`.
6. JSON-LD обрабатывается до AI.
7. Отсутствие JSON-LD не считается ошибкой.
8. JSON-LD не считается абсолютно достоверным.
9. Каждое нормализованное поле должно сохранять source и confidence.
10. Конфликты между JSON-LD, API и HTML должны фиксироваться.
11. Ошибка одного блока не должна останавливать обработку страницы.
12. AI используется только после deterministic extraction.
13. Результаты parsing и AI должны кэшироваться.
14. Повторная обработка выполняется только при изменении страницы.
15. Crawling должен соблюдать robots.txt и ограничения доступа.
16. Поисковый запрос пользователя должен работать преимущественно по локальному индексу, а не запускать полный web crawl.
