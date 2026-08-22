import "server-only";
import { createClient } from "@/lib/supabase/server";
import { throwIfSupabaseError } from "@/lib/supabase/errors";
import { parseDateRangeLiteral } from "@/lib/supabase/date-range";
import { isRangeAvailable, type DateInterval } from "@/lib/availability/ranges";
import type { Locale } from "@/i18n/routing";
import type { SearchCriteria } from "@/lib/search/criteria";
import { emptyResult, type ResultSource, type VesselSearchResult } from "@/lib/search/result";
import { containsTerm } from "@/lib/search/text";

/**
 * `InternalVesselSearchProvider` (spec §6): the project's own catalogue, expressed in the same
 * canonical `VesselSearchResult` every external source is normalized into.
 *
 * The division of labour with ranking is deliberate. Where the DB holds authoritative data —
 * availability, capacity, type — this **hard-filters**, because returning a vessel that is
 * demonstrably booked would be a defect. Where the data is only comparable (price across
 * currencies), it defers to `SearchRankingService`, which knows how to decline to score rather
 * than score wrongly.
 */

/** Upper bound on candidates pulled per search. Ranking reorders these; it never adds to them. */
const INTERNAL_CANDIDATE_LIMIT = 40;

const SELECT_COLUMNS = `id, slug, type, name, description, length_meters, cabins, guests_capacity,
       year_built, rating_avg, rating_count, base_price_minor, currency, latitude, longitude,
       locations ( country, city, marina, latitude, longitude ),
       vessel_images ( url, alt_text, sort_order ),
       vessel_amenities ( amenities ( key ) )`;

interface VesselRow {
  id: string;
  slug: string;
  type: VesselSearchResult["vesselType"];
  name: string;
  description: unknown;
  length_meters: number;
  cabins: number;
  guests_capacity: number;
  year_built: number | null;
  rating_avg: number;
  rating_count: number;
  base_price_minor: number;
  currency: string;
  latitude: number | null;
  longitude: number | null;
  locations: {
    country: unknown;
    city: unknown;
    marina: unknown;
    latitude: number | null;
    longitude: number | null;
  } | null;
  vessel_images: { url: string; alt_text: unknown; sort_order: number }[];
  vessel_amenities: { amenities: { key: string } | null }[];
}

type LocalizedRecord = Partial<Record<string, string>>;

function localized(value: unknown, locale: Locale): string | null {
  const record = (value ?? {}) as LocalizedRecord;
  return record[locale] ?? record.en ?? Object.values(record)[0] ?? null;
}

/** True when any locale's label for this reference row matches the criterion. */
function labelMatches(value: unknown, wanted: string): boolean {
  const record = (value ?? {}) as LocalizedRecord;
  return Object.values(record).some((label) => Boolean(label) && containsTerm(label!, wanted));
}

/**
 * Resolves free-text place names onto `locations` rows. Matching happens in JS rather than SQL
 * because the labels are `{locale: label}` JSONB across an open-ended set of locales — a `->>'en'`
 * comparison would silently fail for a query written in Russian. The table is a small reference
 * list, so reading it whole is cheaper than the query gymnastics.
 *
 * Returns `null` when the query named no place at all (don't filter), and `[]` when it named one
 * we have no location for (filter everything out — we genuinely have nothing there).
 */
async function resolveLocationIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  criteria: SearchCriteria,
): Promise<string[] | null> {
  const wanted = criteria.location;
  if (!wanted) return null;
  const terms = [wanted.marina, wanted.city, wanted.region, wanted.country].filter(
    (term): term is string => Boolean(term),
  );
  if (terms.length === 0) return null;

  const { data, error } = await supabase.from("locations").select("id, country, city, marina");
  throwIfSupabaseError(error);

  return (data ?? [])
    .filter((row) =>
      // Any named part matching is enough: "Split, Croatia" should still match a row whose marina
      // field is empty. Precision is recovered at ranking time by `scoreLocation`.
      terms.some(
        (term) =>
          labelMatches(row.country, term) ||
          labelMatches(row.city, term) ||
          labelMatches(row.marina, term),
      ),
    )
    .map((row) => row.id);
}

/** Blackout periods and active bookings for a batch of vessels, in two queries rather than 2N. */
async function loadUnavailableRanges(
  supabase: Awaited<ReturnType<typeof createClient>>,
  vesselIds: string[],
): Promise<Map<string, DateInterval[]>> {
  const byVessel = new Map<string, DateInterval[]>();
  if (vesselIds.length === 0) return byVessel;

  const [blocked, booked] = await Promise.all([
    supabase.from("availability").select("vessel_id, date_range").in("vessel_id", vesselIds),
    supabase.rpc("get_vessels_booked_ranges", { p_vessel_ids: vesselIds }),
  ]);
  throwIfSupabaseError(blocked.error);
  throwIfSupabaseError(booked.error);

  const push = (vesselId: string, raw: string) => {
    const list = byVessel.get(vesselId) ?? [];
    list.push(parseDateRangeLiteral(raw));
    byVessel.set(vesselId, list);
  };

  // `daterange` has no TypeScript equivalent, so the generated types surface it as `unknown` and
  // every caller narrows it the same way (cf. server/queries/availability.ts).
  for (const row of blocked.data ?? []) push(row.vessel_id, row.date_range as string);
  for (const row of booked.data ?? []) push(row.vessel_id, row.date_range as string);
  return byVessel;
}

function toResult(row: VesselRow, locale: Locale, retrievedAt: string): VesselSearchResult {
  const source: ResultSource = {
    type: "INTERNAL",
    name: "internal",
    domain: null,
    // Locale-relative: the UI prefixes it via next-intl's Link, same as every other internal href.
    url: `/vessels/${row.slug}`,
    retrievedAt,
  };

  const result = emptyResult(`internal:${row.id}`, "INTERNAL", source);
  const images = [...row.vessel_images].sort((a, b) => a.sort_order - b.sort_order);

  return {
    ...result,
    internalVesselId: row.id,
    slug: row.slug,
    name: row.name,
    vesselType: row.type,
    year: row.year_built,
    lengthMeters: row.length_meters,
    capacity: { guests: row.guests_capacity, cabins: row.cabins, beds: null },
    location: {
      country: localized(row.locations?.country, locale),
      region: null,
      city: localized(row.locations?.city, locale),
      marina: localized(row.locations?.marina, locale),
      // The vessel's own pin refines the marina's default point, matching `mapCardRow`.
      latitude: row.latitude ?? row.locations?.latitude ?? null,
      longitude: row.longitude ?? row.locations?.longitude ?? null,
    },
    rental: {
      ...result.rental,
      priceMinor: row.base_price_minor,
      currency: row.currency,
      priceUnit: "DAY",
    },
    description: localized(row.description, locale),
    features: row.vessel_amenities
      .map((link) => link.amenities?.key)
      .filter((key): key is string => Boolean(key)),
    images: images.map((image) => ({ url: image.url, alt: localized(image.alt_text, locale) })),
    ratingAvg: row.rating_avg,
    ratingCount: row.rating_count,
    // Deterministic data straight from our own tables — no `fieldProvenance`, which is exactly
    // the signal that none of it is a model's guess (spec §15).
  };
}

export interface InternalSearchOutcome {
  results: VesselSearchResult[];
  /** Candidates discarded because they were booked or blacked out for the requested window. */
  rejectedForDates: number;
}

export async function searchInternalVessels(
  criteria: SearchCriteria,
  locale: Locale,
): Promise<InternalSearchOutcome> {
  const supabase = await createClient();
  const retrievedAt = new Date().toISOString();

  const locationIds = await resolveLocationIds(supabase, criteria);
  if (locationIds !== null && locationIds.length === 0) {
    // The query named a place we have no vessels in. That's a real, informative empty result.
    return { results: [], rejectedForDates: 0 };
  }

  let query = supabase.from("vessels").select(SELECT_COLUMNS).eq("status", "published");

  if (locationIds) query = query.in("location_id", locationIds);
  if (criteria.vesselType) query = query.eq("type", criteria.vesselType);
  if (criteria.capacity?.persons) query = query.gte("guests_capacity", criteria.capacity.persons);
  if (criteria.capacity?.cabins) query = query.gte("cabins", criteria.capacity.cabins);
  if (criteria.price?.maxMinor) {
    // Applied without regard to currency, matching the existing structured search. It is a coarse
    // pre-filter, not the verdict: `scorePrice` refuses to score mismatched currencies rather than
    // comparing them numerically, so a cross-currency near-miss is demoted, not silently trusted.
    query = query.lte("base_price_minor", criteria.price.maxMinor);
  }

  const { data, error } = await query
    .order("rating_avg", { ascending: false })
    .order("id", { ascending: false })
    .limit(INTERNAL_CANDIDATE_LIMIT);

  throwIfSupabaseError(error);
  const rows = (data ?? []) as unknown as VesselRow[];

  // Dates are filtered only for an exact window. A bare month (spec §4's "в сентябре") has no
  // year, so there is no interval to test — it stays a ranking signal rather than becoming a
  // filter built on a guessed year.
  const wantedFrom = criteria.date?.from ?? null;
  const wantedTo = criteria.date?.to ?? null;
  if (!wantedFrom || !wantedTo) {
    return { results: rows.map((row) => toResult(row, locale, retrievedAt)), rejectedForDates: 0 };
  }

  const requested: DateInterval = { start: wantedFrom, end: wantedTo };
  const unavailable = await loadUnavailableRanges(
    supabase,
    rows.map((row) => row.id),
  );

  const available = rows.filter((row) => isRangeAvailable(requested, unavailable.get(row.id) ?? []));

  return {
    results: available.map((row) => ({
      ...toResult(row, locale, retrievedAt),
      // Survivors are free for exactly the window that was asked for — stated explicitly so
      // `scoreDate` and the UI both work from the same fact rather than re-deriving it.
      availability: { from: wantedFrom, to: wantedTo },
    })),
    rejectedForDates: rows.length - available.length,
  };
}
