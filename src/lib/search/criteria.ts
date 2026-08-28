import { z } from "zod";
import { vesselTypeValues } from "@/lib/validation/search";

/**
 * Normalized search criteria — the output of `SearchQueryInterpreter` (spec §4) and the only
 * shape the rest of the pipeline consumes. Two rules govern every field here:
 *
 * 1. **Absent means `null`, never a guess.** The interpreter must not invent a country because
 *    "Greece" sounds likely, or a guest count because most charters carry six. A `null` tells the
 *    provider "don't filter on this"; a fabricated value silently hides valid results.
 * 2. **Untrusted input.** These values come from an LLM parsing free text, so every field is
 *    wrapped in `orNull` — malformed, missing, or wrong-typed data degrades to `null` instead of
 *    throwing and taking the whole search down with it.
 */

/**
 * AI output is untrusted: a missing, null, or malformed value degrades to `null` rather than
 * failing the parse. Without this a single hallucinated field would reject an otherwise good
 * interpretation.
 */
const orNull = <T extends z.ZodType>(schema: T) =>
  schema
    .nullish()
    .catch(null)
    .transform((value) => value ?? null);

const freeText = (max: number) => z.string().trim().min(1).max(max);

export const durationUnits = ["HOUR", "DAY", "WEEK", "MONTH"] as const;
export type DurationUnit = (typeof durationUnits)[number];

/**
 * How a stated price is metered (Арх §5's `priceUnit`, Арх §7's "normalization also required for
 * ... price unit"). Distinct from `duration` — "до 3000 EUR за неделю" is a *rate* (priceUnit
 * WEEK), not a stated trip length, and the two must not collapse into each other (see
 * `interpret-fallback.ts`'s `extractPriceUnit`). `TRIP` covers a stated total/package price and is
 * never inferred from a bare duration word — only an explicit total-price marker would justify it,
 * which neither interpreter attempts yet.
 */
export const priceUnitValues = ["HOUR", "DAY", "WEEK", "MONTH", "TRIP"] as const;
export type PriceUnit = (typeof priceUnitValues)[number];

/** Charter crewing arrangement (Арх §5's `crewType`), alongside the existing `crew.captainRequired`
 *  / `crewRequired` booleans rather than replacing them — a request can state both ("skippered,
 *  captain required") and the two questions aren't redundant: `crewType` is how the charter is
 *  run, the booleans are what the user is asking for. */
export const crewTypeValues = ["BAREBOAT", "SKIPPERED", "CREWED"] as const;
export type CrewType = (typeof crewTypeValues)[number];

/**
 * Minor units per major unit. The codebase already assumes 2 decimals everywhere money is handled
 * (`formatPrice` divides by 100, the search page multiplies by 100), so this stays consistent with
 * that rather than introducing per-currency exponents only this module would honour.
 */
export const MINOR_UNITS_PER_MAJOR = 100;

/**
 * The interpreter emits prices the way a person says them ("до 5000 EUR"), but money inside the
 * system is always minor units (CLAUDE.md §7). Converting here — at the boundary, once — keeps
 * every downstream consumer on the same footing as `vessels.base_price_minor`.
 */
const priceCriteria = orNull(
  z
    .object({
      min: orNull(z.number().nonnegative()),
      max: orNull(z.number().positive()),
      currency: orNull(z.string().trim().length(3).toUpperCase()),
    })
    .transform((price) => ({
      minMinor: price.min === null ? null : Math.round(price.min * MINOR_UNITS_PER_MAJOR),
      maxMinor: price.max === null ? null : Math.round(price.max * MINOR_UNITS_PER_MAJOR),
      currency: price.currency,
    })),
);

/**
 * Dates arrive in two flavours the pipeline must both support: an exact window ("с 3 по 10
 * сентября" → from/to) and a fuzzy period ("в сентябре" → month, no year). Fuzzy periods can't
 * filter `availability` precisely, so they only inform ranking — see `scoreDateMatch`.
 */
const dateCriteria = orNull(
  z.object({
    // ISO `YYYY-MM-DD`. Kept as a string, not a Date: this object is serialized into a Server
    // Action response and persisted as JSONB in `search_runs`.
    from: orNull(z.iso.date()),
    to: orNull(z.iso.date()),
    /** 1-12, resolved from a month name by the interpreter so downstream code never parses prose. */
    month: orNull(z.number().int().min(1).max(12)),
    year: orNull(z.number().int().min(2000).max(2100)),
    flexible: orNull(z.boolean()),
  }),
);

/** Vessel length in meters — a range, since a query like "12-14 м" states both ends, unlike
 *  `price`'s single ceiling (Арх §5's `lengthMin`/`lengthMax`). */
const lengthCriteria = orNull(
  z.object({
    min: orNull(z.number().positive().max(500)),
    max: orNull(z.number().positive().max(500)),
  }),
);

export const searchCriteriaSchema = z.object({
  location: orNull(
    z.object({
      country: orNull(freeText(100)),
      region: orNull(freeText(100)),
      city: orNull(freeText(100)),
      marina: orNull(freeText(120)),
      /**
       * A resolved search-center point (Арх §5), not something either interpreter extracts from
       * free text — inventing exact coordinates for a place name is a precision-looking guess
       * (CLAUDE.md's "never guess" rule applies doubly hard to numbers that look authoritative).
       * Populated only by a direct-geolocation input path (not built yet) or a downstream
       * place-name → coordinates resolution step (Э3/Э6's coverage prefilter); `searchRadiusKm`
       * below is extracted from text on its own, independent of whether a center is known yet.
       */
      latitude: orNull(z.number().min(-90).max(90)),
      longitude: orNull(z.number().min(-180).max(180)),
    }),
  ),
  date: dateCriteria,
  capacity: orNull(
    z.object({
      persons: orNull(z.number().int().positive().max(500)),
      cabins: orNull(z.number().int().positive().max(100)),
    }),
  ),
  price: priceCriteria,
  /** How the stated price is metered — see `PriceUnit`'s doc comment. Independent of `duration`. */
  priceUnit: orNull(z.enum(priceUnitValues)),
  duration: orNull(
    z.object({
      value: orNull(z.number().positive().max(365)),
      unit: orNull(z.enum(durationUnits)),
    }),
  ),
  length: lengthCriteria,
  crew: orNull(
    z.object({
      captainRequired: orNull(z.boolean()),
      crewRequired: orNull(z.boolean()),
      crewType: orNull(z.enum(crewTypeValues)),
    }),
  ),
  /**
   * Every type the request accepts, in priority order — replaces the old single `vesselType`
   * (Арх §5's `vesselTypes[]`): "яхта или катамаран" names two acceptable types, and a single
   * field can't represent that without picking one arbitrarily.
   *
   * Filters out-of-enum entries rather than degrading the whole list the way `.catch` would: one
   * hallucinated type among several real ones is exactly the "salvageable half of the
   * interpretation" this module's whole `orNull` discipline exists to keep (see the module doc
   * comment) — losing every valid type because of one bad one would be worse than the AI output it
   * is guarding against.
   */
  vesselTypes: z
    .array(z.string())
    .max(vesselTypeValues.length)
    .catch([])
    .default([])
    .transform((values) =>
      values.filter((value): value is (typeof vesselTypeValues)[number] =>
        (vesselTypeValues as readonly string[]).includes(value),
      ),
    ),
  /** Amenity wishes ("wifi", "diving gear") matched against the controlled `amenities.key`
   *  vocabulary — the old `features[]`, renamed now that `activities[]` exists as its
   *  free-form sibling. */
  amenities: z.array(freeText(60)).max(20).catch([]).default([]),
  /**
   * Purpose/activity phrases ("diving", "family holiday", "fishing charter") — Арх §5's
   * `activities[]`. Unlike `amenities`, there is no reference table to match against yet, so
   * this stays free-form text on both interpreters; it isn't wired into ranking or the internal
   * provider's filters until a real data source exists to compare it against (see `ranking.ts`).
   */
  activities: z.array(freeText(60)).max(20).catch([]).default([]),
  /** Radius around `location`'s resolved center, in kilometers (Арх §5's `searchRadiusKm`). Only
   *  meaningful once a center is known; extracted independently of that (see `location.latitude`
   *  above), so it can be present while the center is still unresolved. */
  searchRadiusKm: orNull(z.number().positive().max(20000)),
  /** Leftover meaningful words, used for text matching now and external query building later. */
  keywords: z.array(freeText(60)).max(20).catch([]).default([]),
});

export type SearchCriteria = z.infer<typeof searchCriteriaSchema>;

/** Every field null — what an interpreter returns when it understood nothing. */
export const emptyCriteria: SearchCriteria = searchCriteriaSchema.parse({});

/**
 * True when nothing at all was extracted. The orchestrator uses this to decide whether the query
 * is worth running: with zero criteria an internal search degenerates into "return everything",
 * which is a legitimate result but should be reported to the user as "не понял запрос".
 */
export function isEmptyCriteria(criteria: SearchCriteria): boolean {
  return (
    criteria.location === null &&
    criteria.date === null &&
    criteria.capacity === null &&
    criteria.price === null &&
    criteria.priceUnit === null &&
    criteria.duration === null &&
    criteria.length === null &&
    criteria.crew === null &&
    criteria.vesselTypes.length === 0 &&
    criteria.amenities.length === 0 &&
    criteria.activities.length === 0 &&
    criteria.searchRadiusKm === null &&
    criteria.keywords.length === 0
  );
}

/**
 * A removable chip in the UI (spec §20: "Пользователь может изменить или удалить отдельный
 * критерий"). `path` addresses the field so the client can null it out without knowing the shape;
 * `labelKey`/`value` keep wording in next-intl rather than in this module.
 */
export interface CriteriaChip {
  path: string;
  labelKey: string;
  value: string | number;
  /**
   * Formatting context the value alone doesn't carry — currently only a duration's unit. Without
   * it "2" from `{value: 2, unit: "WEEK"}` renders as "2 days", turning a fortnight into a
   * weekend in front of the user.
   */
  unit?: DurationUnit;
}

/** Flattens criteria into display chips, skipping everything the interpreter left null. */
export function criteriaToChips(criteria: SearchCriteria): CriteriaChip[] {
  const chips: CriteriaChip[] = [];
  const push = (path: string, labelKey: string, value: string | number | null) => {
    if (value !== null && value !== "") chips.push({ path, labelKey, value });
  };

  push("location.country", "country", criteria.location?.country ?? null);
  push("location.region", "region", criteria.location?.region ?? null);
  push("location.city", "city", criteria.location?.city ?? null);
  push("location.marina", "marina", criteria.location?.marina ?? null);
  for (const vesselType of criteria.vesselTypes) {
    push(`vesselTypes.${vesselType}`, "vesselType", vesselType);
  }
  push("capacity.persons", "guests", criteria.capacity?.persons ?? null);
  push("capacity.cabins", "cabins", criteria.capacity?.cabins ?? null);
  push("date.from", "dateFrom", criteria.date?.from ?? null);
  push("date.to", "dateTo", criteria.date?.to ?? null);
  // Month and year are only worth chips when no exact window was resolved — otherwise they
  // duplicate what dateFrom/dateTo already state.
  if (!criteria.date?.from && !criteria.date?.to) {
    push("date.month", "month", criteria.date?.month ?? null);
    push("date.year", "year", criteria.date?.year ?? null);
  }
  if (criteria.duration?.value != null) {
    chips.push({
      path: "duration.value",
      labelKey: "duration",
      value: criteria.duration.value,
      // Left undefined when the interpreter didn't state a unit, so the renderer shows a bare
      // number rather than inventing "days".
      unit: criteria.duration.unit ?? undefined,
    });
  }
  push("length.min", "lengthMin", criteria.length?.min ?? null);
  push("length.max", "lengthMax", criteria.length?.max ?? null);
  push("price.maxMinor", "priceMax", criteria.price?.maxMinor ?? null);
  push("searchRadiusKm", "searchRadiusKm", criteria.searchRadiusKm);
  if (criteria.crew?.captainRequired) push("crew.captainRequired", "captain", 1);
  if (criteria.crew?.crewRequired) push("crew.crewRequired", "crew", 1);
  push("crew.crewType", "crewType", criteria.crew?.crewType ?? null);
  for (const amenity of criteria.amenities) push(`amenities.${amenity}`, "feature", amenity);
  for (const activity of criteria.activities) push(`activities.${activity}`, "activity", activity);

  return chips;
}

/**
 * Removes one chip's criterion, returning fresh criteria. Mirrors `criteriaToChips`'s `path`
 * vocabulary; an unknown path is a no-op rather than an error, since paths round-trip through
 * the client where they could be tampered with.
 */
export function removeCriterion(criteria: SearchCriteria, path: string): SearchCriteria {
  const next = structuredClone(criteria);

  for (const [prefix, key] of [
    ["amenities.", "amenities"],
    ["activities.", "activities"],
  ] as const) {
    if (path.startsWith(prefix)) {
      const value = path.slice(prefix.length);
      next[key] = next[key].filter((entry) => entry !== value);
      return next;
    }
  }

  if (path.startsWith("vesselTypes.")) {
    const vesselType = path.slice("vesselTypes.".length);
    next.vesselTypes = next.vesselTypes.filter((entry) => entry !== vesselType);
    return next;
  }

  const [group, field] = path.split(".");
  if (!field) {
    // A bare top-level scalar path (e.g. `searchRadiusKm`) — arrays and nested groups have their
    // own branches above/below and never reach here.
    if (group in next && !Array.isArray(next[group as keyof SearchCriteria])) {
      (next as Record<string, unknown>)[group] = null;
    }
    return next;
  }

  const target = next[group as keyof SearchCriteria];
  if (target && typeof target === "object" && !Array.isArray(target) && field in target) {
    (target as Record<string, unknown>)[field] = null;
    // A group whose every field is now null carries no meaning — collapse it so `isEmptyCriteria`
    // and the providers see a clean absence rather than an object full of nulls.
    if (Object.values(target).every((value) => value === null)) {
      (next as Record<string, unknown>)[group] = null;
    }
  }
  return next;
}
