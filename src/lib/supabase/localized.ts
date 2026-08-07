import type { Locale } from "@/i18n/routing";

/** Reads a `{locale: label}` jsonb column (e.g. locations.country) for the current locale. */
export function pickLocalized(
  value: Partial<Record<Locale, string>> | null | undefined,
  locale: Locale,
): string {
  if (!value) return "";
  return value[locale] ?? value.ru ?? Object.values(value)[0] ?? "";
}
