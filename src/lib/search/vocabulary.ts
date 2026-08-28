import type { VesselType } from "@/lib/search/offer";
import { normalizeForMatch } from "@/lib/search/text";

/**
 * The controlled vocabulary the deterministic interpreter matches user prose against.
 *
 * It is built from the project's own reference data — `locations`, `amenities`, and the
 * next-intl labels for `vessel_type` — never from a hardcoded list. That is CLAUDE.md §9's rule
 * ("страны, валюты, языки и новые типы судов добавляются данными в справочниках") applied to
 * search: adding a country to `locations` immediately teaches the interpreter to recognise it,
 * with no code change.
 */

export interface VocabularyEntry {
  /** The canonical form handed to downstream filters — stable regardless of the query's language. */
  value: string;
  /** Every surface form for this entry across all locales, including the canonical one. */
  aliases: string[];
  /**
   * The label per locale, for display. The canonical `value` is deliberately one language's label
   * so that matching is stable, which makes it the wrong thing to show a user reading another —
   * a Russian visitor should see "Греция" on a chip, not "Greece". Only populated where the source
   * data is localized (places); vessel types and amenities are translated through next-intl.
   */
  labels?: Partial<Record<string, string>>;
}

export interface VesselTypeEntry {
  value: VesselType;
  aliases: string[];
}

export interface SearchVocabulary {
  countries: VocabularyEntry[];
  cities: VocabularyEntry[];
  marinas: VocabularyEntry[];
  vesselTypes: VesselTypeEntry[];
  /** Amenity slugs (`amenities.key`) with their translated labels as aliases. */
  features: VocabularyEntry[];
}

export const emptyVocabulary: SearchVocabulary = {
  countries: [],
  cities: [],
  marinas: [],
  vesselTypes: [],
  features: [],
};

/**
 * Collapses `{locale: label}` maps into vocabulary entries, merging duplicates by canonical value.
 * The canonical value is the first non-empty label in `preferredLocaleOrder`, so entries stay
 * comparable across queries written in different languages.
 */
export function collectEntries(
  localizedValues: Array<Partial<Record<string, string>> | null | undefined>,
  preferredLocaleOrder: readonly string[],
): VocabularyEntry[] {
  const byValue = new Map<string, Set<string>>();
  const labelsByValue = new Map<string, Partial<Record<string, string>>>();

  for (const localized of localizedValues) {
    if (!localized) continue;
    const labels = preferredLocaleOrder
      .map((locale) => localized[locale]?.trim())
      .filter((label): label is string => Boolean(label));
    // Locales beyond the preferred order still contribute aliases — they just never win the
    // canonical slot, so a future third locale widens matching without shifting existing values.
    const extras = Object.values(localized)
      .map((label) => label?.trim())
      .filter((label): label is string => Boolean(label));

    const canonical = labels[0] ?? extras[0];
    if (!canonical) continue;

    const aliases = byValue.get(canonical) ?? new Set<string>();
    for (const label of [...labels, ...extras]) aliases.add(label);
    byValue.set(canonical, aliases);

    const perLocale = labelsByValue.get(canonical) ?? {};
    for (const [locale, label] of Object.entries(localized)) {
      const trimmed = label?.trim();
      if (trimmed) perLocale[locale] = trimmed;
    }
    labelsByValue.set(canonical, perLocale);
  }

  return [...byValue].map(([value, aliases]) => ({
    value,
    aliases: [...aliases],
    labels: labelsByValue.get(value) ?? {},
  }));
}

/**
 * Adds single words from multi-word labels as aliases, but only words that belong to exactly one
 * entry.
 *
 * Reference labels are written as full noun phrases — "Экспедиционное судно", "Research vessel",
 * "Моторная яхта" — while people type one word: "для экспедиции", "нужна яхта". Matching only the
 * full phrase misses all of those.
 *
 * The uniqueness rule is what keeps this from backfiring, and it needs no stopword list: "судно"
 * and "vessel" appear in several type labels, so they're recognised as generic and dropped
 * automatically, while "экспедиционное" and "яхта" appear once and become aliases. Adding a new
 * vessel type re-derives all of this from the new label set.
 */
export function withDistinctiveWordAliases<T extends { value: string; aliases: string[] }>(
  entries: T[],
  minWordLength = 4,
): T[] {
  const owners = new Map<string, Set<string>>();

  for (const entry of entries) {
    for (const alias of entry.aliases) {
      for (const word of normalizeForMatch(alias).split(" ")) {
        if (word.length < minWordLength) continue;
        const set = owners.get(word) ?? new Set<string>();
        set.add(entry.value);
        owners.set(word, set);
      }
    }
  }

  return entries.map((entry) => {
    const extra = new Set(entry.aliases);
    for (const alias of entry.aliases) {
      const words = normalizeForMatch(alias).split(" ");
      if (words.length < 2) continue; // Single-word labels are already their own alias.
      for (const word of words) {
        if (word.length < minWordLength) continue;
        if (owners.get(word)?.size === 1) extra.add(word);
      }
    }
    return { ...entry, aliases: [...extra] };
  });
}
