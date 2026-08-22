import "server-only";
import { cache } from "react";
import { getMessages } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { throwIfSupabaseError } from "@/lib/supabase/errors";
import { routing } from "@/i18n/routing";
import { vesselTypeValues } from "@/lib/validation/search";
import {
  collectEntries,
  withDistinctiveWordAliases,
  type SearchVocabulary,
  type VesselTypeEntry,
  type VocabularyEntry,
} from "@/lib/search/vocabulary";

/**
 * Builds the controlled vocabulary the query interpreter matches against, entirely from data the
 * project already owns: `locations` for places, `amenities` + their next-intl labels for features,
 * and the `vessels.types.*` labels for vessel types.
 *
 * Nothing here is a hardcoded list, which is what CLAUDE.md §9 requires — seed a new country into
 * `locations` and the interpreter recognises it on the next request, in every locale, with no code
 * change and no redeploy of a dictionary.
 */

type LocalizedRecord = Partial<Record<string, string>>;

/** Reads `namespace.key` out of a locale's message tree, tolerating a missing branch. */
function readMessage(messages: unknown, path: string[]): string | undefined {
  let cursor: unknown = messages;
  for (const segment of path) {
    if (typeof cursor !== "object" || cursor === null) return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return typeof cursor === "string" ? cursor : undefined;
}

export const buildSearchVocabulary = cache(async (): Promise<SearchVocabulary> => {
  const supabase = await createClient();

  const [locationsResult, amenitiesResult, messagesByLocale] = await Promise.all([
    supabase.from("locations").select("country, city, marina"),
    supabase.from("amenities").select("key"),
    Promise.all(
      routing.locales.map(async (locale) => ({ locale, messages: await getMessages({ locale }) })),
    ),
  ]);

  throwIfSupabaseError(locationsResult.error);
  throwIfSupabaseError(amenitiesResult.error);

  const locations = locationsResult.data ?? [];
  const countries = collectEntries(
    locations.map((row) => row.country as LocalizedRecord | null),
    routing.locales,
  );
  const cities = collectEntries(
    locations.map((row) => row.city as LocalizedRecord | null),
    routing.locales,
  );
  const marinas = collectEntries(
    locations.map((row) => row.marina as LocalizedRecord | null),
    routing.locales,
  );

  // Vessel types and amenities are keyed by slug in the DB/enum and translated in `messages/`, so
  // the canonical value stays the slug and every locale's label becomes an alias.
  const vesselTypes: VesselTypeEntry[] = vesselTypeValues.map((value) => ({
    value,
    aliases: [
      value,
      ...messagesByLocale
        .map(({ messages }) => readMessage(messages, ["vessels", "types", value]))
        .filter((label): label is string => Boolean(label)),
    ],
  }));

  const features: VocabularyEntry[] = (amenitiesResult.data ?? []).map((row) => ({
    value: row.key,
    aliases: [
      row.key,
      // Slugs read as words once the underscores go ("air_conditioning" → "air conditioning").
      row.key.replace(/_/g, " "),
      ...messagesByLocale
        .map(({ messages }) => readMessage(messages, ["vessels", "amenities", row.key]))
        .filter((label): label is string => Boolean(label)),
    ],
  }));

  return {
    countries,
    cities,
    marinas,
    vesselTypes: withDistinctiveWordAliases(vesselTypes),
    features: withDistinctiveWordAliases(features),
  };
});
