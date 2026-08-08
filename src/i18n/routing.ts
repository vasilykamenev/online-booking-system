import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["en", "ru"],
  defaultLocale: "en",
  // Without this, next-intl negotiates by browser Accept-Language and can still
  // redirect "/" to /ru for Russian-speaking visitors — the site should default
  // to English regardless of browser language; visitors switch via LocaleSwitcher.
  localeDetection: false,
});

export type Locale = (typeof routing.locales)[number];
