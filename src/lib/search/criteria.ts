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

export const searchCriteriaSchema = z.object({
  location: orNull(
    z.object({
      country: orNull(freeText(100)),
      region: orNull(freeText(100)),
      city: orNull(freeText(100)),
      marina: orNull(freeText(120)),
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
  duration: orNull(
    z.object({
      value: orNull(z.number().positive().max(365)),
      unit: orNull(z.enum(durationUnits)),
    }),
  ),
  crew: orNull(
    z.object({
      captainRequired: orNull(z.boolean()),
      crewRequired: orNull(z.boolean()),
    }),
  ),
  /** Constrained to the project's own enum so the value is directly usable as a DB filter. */
  vesselType: orNull(z.enum(vesselTypeValues)),
  /** Amenity-like wishes ("wifi", "diving gear") — matched loosely against `amenities.key`. */
  features: z.array(freeText(60)).max(20).catch([]).default([]),
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
    criteria.duration === null &&
    criteria.crew === null &&
    criteria.vesselType === null &&
    criteria.features.length === 0 &&
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
  push("vesselType", "vesselType", criteria.vesselType);
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
  push("price.maxMinor", "priceMax", criteria.price?.maxMinor ?? null);
  if (criteria.crew?.captainRequired) push("crew.captainRequired", "captain", 1);
  if (criteria.crew?.crewRequired) push("crew.crewRequired", "crew", 1);
  for (const feature of criteria.features) push(`features.${feature}`, "feature", feature);

  return chips;
}

/**
 * Removes one chip's criterion, returning fresh criteria. Mirrors `criteriaToChips`'s `path`
 * vocabulary; an unknown path is a no-op rather than an error, since paths round-trip through
 * the client where they could be tampered with.
 */
export function removeCriterion(criteria: SearchCriteria, path: string): SearchCriteria {
  const next = structuredClone(criteria);

  if (path.startsWith("features.")) {
    const feature = path.slice("features.".length);
    next.features = next.features.filter((value) => value !== feature);
    return next;
  }

  const [group, field] = path.split(".");
  if (!field) {
    if (group === "vesselType") next.vesselType = null;
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
