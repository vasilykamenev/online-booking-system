import { z } from "zod";
import type { Database } from "@/lib/supabase/database.types";

export const vesselTypeValues = [
  "yacht",
  "catamaran",
  "expedition",
  "research",
  "hybrid",
] as const satisfies readonly Database["public"]["Enums"]["vessel_type"][];

export const vesselSortValues = ["rating_desc", "price_asc", "price_desc", "length_desc"] as const;
export type VesselSort = (typeof vesselSortValues)[number];

/** Empty strings come from cleared number/date inputs and must mean "no filter", not 0 or "". */
const emptyToUndefined = (value: unknown) => (value === "" ? undefined : value);
const numberFilter = z.preprocess(emptyToUndefined, z.coerce.number().int().positive().optional());
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const dateFilter = z.preprocess(emptyToUndefined, isoDate.optional());

/**
 * Every field here is independently optional by design — this is a browse/filter search, not a
 * wizard, so any subset of criteria (just a location, just dates, just a price ceiling, all of
 * them, none of them) must produce a valid query. `server/queries/vessels.ts` mirrors this: each
 * filter is applied to the query only `if` it's present, never assumed.
 */
export const searchParamsSchema = z
  .object({
    type: z.enum(vesselTypeValues).optional(),
    // `.guid()` rather than the stricter `.uuid()`: seed data uses placeholder ids
    // like "20000000-0000-0000-0000-000000000001" without a valid RFC 4122 version/variant nibble.
    location: z.guid().optional(),
    guests: z.preprocess(emptyToUndefined, z.coerce.number().int().positive().max(200).optional()),
    priceMin: numberFilter,
    priceMax: numberFilter,
    lengthMin: numberFilter,
    lengthMax: numberFilter,
    cabinsMin: numberFilter,
    // Both ends are collected, but only ever act as a filter together (see `dateFrom`/`dateTo`'s
    // refine below and `searchVessels`'s `wantsDateFilter`) — a lone end has no interval to test
    // availability against, so it's kept as typed-but-inert rather than rejected.
    dateFrom: dateFilter,
    dateTo: dateFilter,
    sort: z.enum(vesselSortValues).optional(),
    cursor: z.string().optional(),
  })
  .refine((data) => !data.dateFrom || !data.dateTo || data.dateTo > data.dateFrom, {
    message: "dateTo must be after dateFrom",
    path: ["dateTo"],
  })
  .refine((data) => data.priceMin === undefined || data.priceMax === undefined || data.priceMax >= data.priceMin, {
    message: "priceMax must be at least priceMin",
    path: ["priceMax"],
  })
  .refine(
    (data) => data.lengthMin === undefined || data.lengthMax === undefined || data.lengthMax >= data.lengthMin,
    { message: "lengthMax must be at least lengthMin", path: ["lengthMax"] },
  );

export type SearchParams = z.infer<typeof searchParamsSchema>;
/** Raw form/URL shape before the numeric/date preprocess coerces fields to their final types. */
export type SearchParamsInput = z.input<typeof searchParamsSchema>;

/**
 * Next.js page `searchParams` is `Record<string, string | string[] | undefined>`; flatten before
 * validating. A single field failing validation (e.g. a hand-edited URL with `dateTo` before
 * `dateFrom`) drops back to "no filters" for the whole query rather than 500ing the page — the
 * same tolerant fallback `parseSearchParams` already had before these fields existed.
 */
export function parseSearchParams(
  raw: Record<string, string | string[] | undefined>,
): SearchParams {
  const flat = Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [
      key,
      Array.isArray(value) ? value[0] : value,
    ]),
  );
  const result = searchParamsSchema.safeParse(flat);
  return result.success ? result.data : {};
}

/**
 * Builds `/search?...` from a filter set, dropping `cursor` (any deliberate change to filters or
 * sort always resets pagination — a stale cursor from a *different* filter set is meaningless) and
 * every field that's absent. This is the one place that knows the query-string shape; the filters
 * bar, the sort control, and each filter chip's remove button all go through it rather than each
 * serializing `URLSearchParams` their own way.
 */
export function buildSearchUrl(params: Omit<SearchParams, "cursor">): string {
  const search = new URLSearchParams();
  if (params.type) search.set("type", params.type);
  if (params.location) search.set("location", params.location);
  if (params.guests) search.set("guests", String(params.guests));
  if (params.priceMin) search.set("priceMin", String(params.priceMin));
  if (params.priceMax) search.set("priceMax", String(params.priceMax));
  if (params.lengthMin) search.set("lengthMin", String(params.lengthMin));
  if (params.lengthMax) search.set("lengthMax", String(params.lengthMax));
  if (params.cabinsMin) search.set("cabinsMin", String(params.cabinsMin));
  if (params.dateFrom) search.set("dateFrom", params.dateFrom);
  if (params.dateTo) search.set("dateTo", params.dateTo);
  if (params.sort) search.set("sort", params.sort);

  const query = search.toString();
  return query ? `/search?${query}` : "/search";
}

/**
 * Which filter "chips" are active, for `ActiveFilterChips` — a pure function so the (non-trivial)
 * rule "a date range is one chip, not two" is unit-testable without rendering anything. `dateFrom`
 * without `dateTo` (or vice versa) never appears here: per `searchParamsSchema`, a lone end is
 * typed-but-inert, so it isn't a filter the user can perceive as "on" yet.
 */
export const filterChipKeyValues = [
  "type",
  "location",
  "guests",
  "priceMin",
  "priceMax",
  "lengthMin",
  "lengthMax",
  "cabinsMin",
  "dates",
] as const;
export type FilterChipKey = (typeof filterChipKeyValues)[number];

export function activeFilterChipKeys(filters: SearchParams): FilterChipKey[] {
  const keys: FilterChipKey[] = [];
  if (filters.type) keys.push("type");
  if (filters.location) keys.push("location");
  if (filters.guests) keys.push("guests");
  if (filters.priceMin) keys.push("priceMin");
  if (filters.priceMax) keys.push("priceMax");
  if (filters.lengthMin) keys.push("lengthMin");
  if (filters.lengthMax) keys.push("lengthMax");
  if (filters.cabinsMin) keys.push("cabinsMin");
  if (filters.dateFrom && filters.dateTo) keys.push("dates");
  return keys;
}

/** The URL for "every currently active filter, minus this one chip" — `"dates"` drops both ends
 *  together, since a lone end is inert (see `activeFilterChipKeys`) and would leave a chip-less
 *  filter silently still applied. */
export function removeSearchFilterUrl(filters: SearchParams, chipKey: FilterChipKey): string {
  const rest: SearchParams = { ...filters };
  delete rest.cursor;
  if (chipKey === "dates") {
    delete rest.dateFrom;
    delete rest.dateTo;
  } else {
    delete rest[chipKey];
  }
  return buildSearchUrl(rest);
}
