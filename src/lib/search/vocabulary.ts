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
  /**
   * Canonical city value → canonical country value, so a query naming only a city ("яхта в
   * Сплите") can still filter by country without the user stating both. Keyed and valued by the
   * same canonical strings as `cities[].value` / `countries[].value`.
   */
  cityCountries: Record<string, string>;
}

export const emptyVocabulary: SearchVocabulary = {
  countries: [],
  cities: [],
  marinas: [],
  vesselTypes: [],
  features: [],
  cityCountries: {},
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

/** The same canonical-label precedence `collectEntries` uses: first non-empty label from
 *  `preferredLocaleOrder`, else any other locale's label. */
function canonicalLabel(
  localized: Partial<Record<string, string>> | null | undefined,
  preferredLocaleOrder: readonly string[],
): string | null {
  if (!localized) return null;
  for (const locale of preferredLocaleOrder) {
    const label = localized[locale]?.trim();
    if (label) return label;
  }
  const extra = Object.values(localized)
    .map((label) => label?.trim())
    .find((label): label is string => Boolean(label));
  return extra ?? null;
}

/**
 * Maps each city's canonical value to the canonical value of the country it was seeded under.
 * Built straight from `locations` rows — each row already pairs one city with one country — not
 * from `collectEntries`'s output, which merges rows by value and loses that per-row pairing.
 *
 * A city named under more than one country (unlikely in real data, but not impossible for a
 * common name) keeps whichever country its first row named; that is still a better guess surface
 * than matching no country at all, and the interpreter only ever uses this as a fallback for when
 * the query didn't state a country itself.
 */
export function collectCityCountries(
  rows: readonly {
    country: Partial<Record<string, string>> | null | undefined;
    city: Partial<Record<string, string>> | null | undefined;
  }[],
  preferredLocaleOrder: readonly string[],
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const row of rows) {
    const city = canonicalLabel(row.city, preferredLocaleOrder);
    const country = canonicalLabel(row.country, preferredLocaleOrder);
    if (!city || !country || city in result) continue;
    result[city] = country;
  }
  return result;
}

/**
 * Adds single words from multi-word labels as aliases, but only words shared by a small enough
 * group of entries (`maxSharedOwners`) to still mean something — added to *every* entry in that
 * group, not just picked arbitrarily.
 *
 * Reference labels are written as full noun phrases — "Экспедиционное судно", "Research vessel",
 * "Моторная яхта" — while people type one word: "для экспедиции", "нужна яхта". Matching only the
 * full phrase misses all of those.
 *
 * A word owned by *one* entry is the easy case. The harder one — this function's whole reason for
 * a threshold instead of a flat uniqueness check — is a word owned by a couple of sibling entries:
 * "яхта" names both "Моторная яхта" (MOTOR_YACHT) and "Парусная яхта" (SAILING_YACHT). Dropping it
 * as "ambiguous" (an earlier version of this function did) makes a bare "яхта"/"yacht" mention
 * match *no* vessel type at all — indistinguishable from not filtering by type, which silently
 * widens the search to catamarans, research vessels and every other unrelated type the query never
 * asked for. Adding it to both siblings instead keeps the filter exactly as narrow as the word
 * itself is: "any yacht", not "any vessel". A word spread across many unrelated entries ("судно"/
 * "vessel" — expedition, research, and "other" share no closer relation than being *some* boat) is
 * still dropped past `maxSharedOwners`: at that point it's genuinely generic, not a shared parent
 * category, and matching it would blur types that have nothing else in common. Adding a new
 * vessel type re-derives all of this from the new label set, with no code change either way.
 */
export function withDistinctiveWordAliases<T extends { value: string; aliases: string[] }>(
  entries: T[],
  minWordLength = 4,
  maxSharedOwners = 1,
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

  const derived = new Map<string, Set<string>>();
  for (const entry of entries) {
    for (const alias of entry.aliases) {
      const words = normalizeForMatch(alias).split(" ");
      if (words.length < 2) continue; // Single-word labels are already their own alias.
      for (const word of words) {
        if (word.length < minWordLength) continue;
        const ownerValues = owners.get(word);
        if (!ownerValues || ownerValues.size > maxSharedOwners) continue;
        for (const ownerValue of ownerValues) {
          const set = derived.get(ownerValue) ?? new Set<string>();
          set.add(word);
          derived.set(ownerValue, set);
        }
      }
    }
  }

  return entries.map((entry) => ({
    ...entry,
    aliases: [...new Set([...entry.aliases, ...(derived.get(entry.value) ?? [])])],
  }));
}
