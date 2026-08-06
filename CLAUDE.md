# CLAUDE.md

Инструкции для Claude Code по разработке этого проекта.

## 1. Что мы строим

**Платформа онлайн-бронирования яхт и экспедиционных судов** + раздел морских
инициатив и экспедиционных проектов.

Полное бизнес-задание: [BRD_v1.md](./BRD_v1.md) — это источник истины по
требованиям. Перед реализацией любой фичи сверяйся с соответствующим разделом BRD.

Два продукта в одном:

1. **Booking** — поиск → сравнение → бронирование → оплата судна.
   Три роли: Клиент, Владелец (флот, календарь, цены, доходы), Администратор.
2. **Initiatives** — публикация и поиск экспедиционных/исследовательских
   инициатив, отклики, установление контактов. Платформа даёт только техническую
   среду, **не модерирует содержание** (BRD §4) — не строим систему модерации
   контента инициатив, только abuse-репорты.

## 2. Стек

Фиксированный. Не заменяй библиотеки без явной просьбы пользователя.

| Слой | Выбор | Заметки |
|---|---|---|
| Фреймворк | **Next.js 16, App Router**, React 19, TypeScript strict | Server Components по умолчанию |
| Стили | **Tailwind CSS v4** (CSS-first, `@theme`) | Конфиг в `app/globals.css`, не в `tailwind.config.ts` |
| UI-кит | **shadcn/ui** (Radix + CVA) | `npx shadcn@latest add <component>` |
| Иконки | **lucide-react** | Только stroke-иконки, `strokeWidth={1.5}` |
| Анимации | **motion** (бывш. framer-motion) | Только в клиентских компонентах |
| БД + Auth + Storage | **Supabase** (Postgres, RLS, Auth, Storage) | Миграции в `supabase/migrations/` |
| Формы | **react-hook-form** + **zod** | Одна zod-схема на серверную и клиентскую валидацию |
| Данные на клиенте | **@tanstack/react-query** | Только для интерактивных списков/фильтров |
| Даты | **date-fns** + **react-day-picker** | Все даты в БД — UTC, `timestamptz` |
| Платежи | **Stripe** (карты) + ручные переводы | См. §8 |
| i18n | **next-intl**, сегмент `[locale]` | ru / en с первого дня |
| Тосты | **sonner** | |
| Тесты | **vitest** + **@testing-library/react**, **playwright** для e2e | |

**Референс-шаблон:** https://github.com/vasilykamenev/remix-of-glamping-off-grid-retreat-booking-template
Оттуда берём **дизайн-язык и композицию секций** (hero-тикер, карточки локаций,
типографика, воздух). Оттуда **не** берём архитектуру: там Vite + react-router +
клиентский рендеринг — у нас Next.js App Router и серверный рендеринг.

## 3. Команды

```bash
npm run dev          # dev-сервер (Turbopack), http://localhost:3000
npm run build        # прод-сборка — должна проходить перед любым коммитом
npm run lint         # eslint
npm run typecheck    # tsc --noEmit
npm run test         # vitest
npm run test:e2e     # playwright
npx supabase start   # локальный Supabase (Docker)
npx supabase db reset # пересоздать локальную БД + миграции + seed
npx supabase gen types typescript --local > src/lib/supabase/database.types.ts
```

После любого изменения схемы БД — обязательно перегенерировать `database.types.ts`.

## 4. Структура проекта

```
src/
  app/
    [locale]/
      (marketing)/          # лендинг, о нас, контакты — статика, ISR
      (booking)/
        search/             # поиск и фильтры судов
        vessels/[slug]/     # карточка судна + календарь + бронирование
        booking/[id]/       # оформление и оплата
      (initiatives)/
        initiatives/        # лента инициатив, фильтры
        initiatives/[id]/   # инициатива + отклики
      account/              # ЛК клиента: профиль, история, избранное
      owner/                # ЛК владельца: суда, календарь, цены, заявки, финансы
      admin/                # админка: пользователи, комиссии, справочники, аналитика
      auth/                 # вход, регистрация, 2FA, восстановление
    api/
      webhooks/stripe/      # вебхуки платежей
  components/
    ui/                     # shadcn — НЕ править вручную без причины
    booking/                # доменные компоненты бронирования
    vessels/
    initiatives/
    layout/                 # Header, Footer, Nav
  lib/
    supabase/               # client.ts, server.ts, middleware.ts, database.types.ts
    pricing/                # расчёт стоимости — чистые функции, покрыты тестами
    validation/             # zod-схемы, общие для клиента и сервера
    i18n/
  server/
    actions/                # Server Actions по доменам: vessels.ts, bookings.ts ...
    queries/                # серверные выборки данных
  types/
messages/                   # ru.json, en.json
supabase/
  migrations/
  seed.sql
```

## 5. Дизайн-система

Направление: **современный, «премиальный морской»** — много воздуха, крупные
фотографии на весь экран, тонкая типографика, сдержанные цвета, мягкие анимации.
Ощущение travel-журнала, не «маркетплейса с плашками».

### Токены

Все токены объявляются один раз в `app/globals.css` через Tailwind v4 `@theme`.
**Никаких hardcoded-цветов в компонентах** — только семантические классы
(`bg-background`, `text-muted-foreground`, `border-border`). Все цвета в HSL/oklch.

Палитра (адаптация референса под морскую тему):

```css
@theme {
  --color-background: hsl(0 0% 99%);
  --color-foreground: hsl(205 25% 15%);      /* глубокий графит-синий */
  --color-primary: hsl(200 45% 30%);         /* морская глубина */
  --color-accent: hsl(35 40% 65%);           /* латунь / песок */
  --color-muted: hsl(200 12% 96%);
  --color-border: hsl(200 10% 91%);
  --radius: 0.5rem;
  --shadow-soft: 0 2px 8px hsl(0 0% 0% / 0.04);
  --shadow-hover: 0 4px 16px hsl(0 0% 0% / 0.08);
}
```

Тёмная тема — обязательна, через `next-themes` и `.dark`-переопределение токенов.

### Правила вёрстки

- **Типографика:** один sans-шрифт через `next/font` — **Manrope** (`subsets: ["latin", "cyrillic"]`).
  DM Sans не поддерживает кириллицу, поэтому не подходит при ru-локали.
  Заголовки — `font-light`, `tracking-tight`, крупные (`text-5xl`…`text-7xl`).
  Надзаголовки секций — `text-[11px] uppercase tracking-wider text-muted-foreground`.
- **Ритм:** вертикальные отступы секций `py-24 lg:py-32`; контейнер
  `container mx-auto px-6 lg:px-12`, max-width 1400px.
- **Hero:** full-bleed слайдер фотографий с плавным кросс-фейдом, тонкие
  progress-bar'ы внизу, текст и CTA в нижнем левом углу (как в референсе).
- **Карточки судов:** фото 4:3, бейдж рейтинга поверх фото в правом верхнем углу
  (`bg-card/95 backdrop-blur-sm`), название → марина с иконкой `MapPin` → чипы
  характеристик (кают, гостей, длина) → цена/сутки и CTA.
- **Анимации:** только `opacity` и `transform`, длительность 300–800 мс,
  `ease-out`. Появление секций — `whileInView` с `once: true`.
  Уважай `prefers-reduced-motion`.
- **Изображения:** только `next/image`, обязательный `sizes`, `priority` только
  для первого экрана. Фото судов — WebP/AVIF через Supabase Storage + трансформации.
- **Адаптивность:** mobile-first. На мобильных — карусель вместо сеток,
  bottom-sheet (`vaul`) вместо модалок для фильтров и выбора дат.
- **Доступность:** контраст ≥ 4.5:1, видимый focus-ring, все интерактивные
  элементы достижимы с клавиатуры, `aria-label` на иконочных кнопках.

## 6. Доменная модель

Основные таблицы (BRD §5–§7). Все — с `id uuid`, `created_at`, `updated_at`.

- `profiles` — пользователь + `role: client | owner | admin`, язык, валюта
- `vessels` — судно: тип (`yacht | catamaran | expedition | research | hybrid`),
  длина, каюты, места, год, марина, владелец, статус публикации
- `vessel_images`, `vessel_amenities`
- `locations` — страна / город / марина (справочник)
- `availability` — занятые/свободные интервалы по судну
- `pricing_rules` — сезонные и региональные цены, скидки, спрос (BRD §4.1)
- `bookings` — статусы `pending | confirmed | paid | cancelled | completed`,
  **зафиксированная цена на момент брони** (BRD §11)
- `payments` — провайдер, статус, сумма, комиссия платформы
- `reviews` — отзыв клиента после завершённого бронирования
- `favorites`
- `initiatives` — инициатива/проект: тематика, регион, тип деятельности, автор
- `initiative_responses` — отклик (участие / сотрудничество / запрос информации)
- `conversations`, `messages` — контакты между участниками
- `notifications`
- `audit_log` — действия админов

**Обязательные инварианты:**

1. Бронирование возможно только на свободные даты — проверка пересечения
   интервалов **в транзакции на стороне БД** (exclusion constraint по
   `daterange`), а не только в UI.
2. Цена фиксируется в `bookings` при создании и не пересчитывается позже.
3. Отмена — только по политике возвратов, привязанной к судну.

## 7. Правила разработки

- **Server Components по умолчанию.** `"use client"` — только там, где нужен
  стейт, эффекты или обработчики. Не тащи данные на клиент ради рендера списка.
- **Мутации — только через Server Actions** в `src/server/actions/`. Каждое
  действие: `zod`-валидация входа → проверка прав → операция → `revalidatePath`.
- **Безопасность — на уровне БД.** RLS-политики включены для всех таблиц.
  Клиент видит свои брони, владелец — только свои суда и заявки по ним.
  Не полагайся на проверки только в UI. Service-role ключ — исключительно на
  сервере, никогда не в клиентском бандле.
- **Расчёт стоимости** (`src/lib/pricing/`) — чистые функции без обращений к БД,
  покрыты unit-тестами. Любое изменение формулы начинается с теста.
- **Типы из БД** — только сгенерированные (`database.types.ts`), не пиши руками.
- **Деньги** — в минорных единицах (`integer`, копейки/центы) + код валюты.
  Никогда не `float`.
- **Тексты** — только через `next-intl`, никаких строк в JSX.
- **Ошибки** — `error.tsx` и `loading.tsx` в каждом сегменте маршрута.

## 8. Платежи

- Карты — Stripe Checkout / Payment Intents; подтверждение брони **только по
  вебхуку**, не по редиректу пользователя.
- Банковские переводы и предоплата — статус `pending`, ручное подтверждение
  владельцем/админом.
- Комиссия платформы считается на сервере и пишется в `payments`.
- Вебхуки — идемпотентны, проверяй подпись.

## 9. Нефункциональные требования (BRD §8)

Не «оптимизация потом», а критерии приёмки:

- LCP ≤ 2 с, ответ поиска ≤ 1 с. Поиск — серверный, с индексами по локации,
  датам, цене, типу судна; пагинация курсорная.
- HTTPS, 2FA (Supabase MFA), шифрование чувствительных полей, бэкапы.
- Масштабируемость: страны, валюты, языки и новые типы судов добавляются
  **данными в справочниках**, а не новым кодом. Не хардкодь список стран,
  валют или типов судов в компонентах.

## 10. Порядок работ

Строим итерациями, каждая — рабочее приложение:

1. Каркас: Next.js + Tailwind v4 + shadcn + i18n + темы + layout/Header/Footer.
2. Дизайн-система и лендинг (hero, секции, футер) на моковых данных.
3. Supabase: схема, RLS, миграции, seed. Каталог и карточка судна на реальных данных.
4. Поиск и фильтры.
5. Auth + роли + ЛК клиента (профиль, избранное, история).
6. Календарь доступности, расчёт цены, бронирование без оплаты.
7. Платежи Stripe + вебхуки + статусы броней.
8. ЛК владельца: суда, календарь, цены, заявки, финансы.
9. Инициативы: публикация, лента, фильтры, отклики, сообщения.
10. Админка и отчёты (BRD §10).

Не начинай следующий этап, пока предыдущий не собирается и не проходит тесты.

## 11. Чего не делать

- Не добавляй новые зависимости, если задачу решает уже выбранная библиотека.
- Не правь файлы в `components/ui/` руками — обновляй через `shadcn` CLI или
  оборачивай в свой компонент.
- Не пиши бизнес-логику в компонентах — она живёт в `src/lib/` и `src/server/`.
- Не делай модерацию содержания инициатив (BRD §4).
- Не коммить `.env*`, ключи Supabase/Stripe, дампы БД.
- Не запускай `supabase db reset` против удалённой базы.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
