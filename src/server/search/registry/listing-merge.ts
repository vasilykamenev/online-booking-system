import type { Database } from "@/lib/supabase/database.types";

/**
 * Pure merge/conflict logic for `search_extracted_listings` (docs/data-merger-provenance-design.md §3).
 * No I/O here by design (same split as `providers/generic/normalize.ts`) — `extracted-listings.ts` reads
 * the existing row and any open conflicts, calls this, and writes the result back.
 *
 * The core question this answers (design doc §3.2): a fresh extraction of a page is compared against the
 * *last persisted* value of each field, not against another extraction from the same request — the
 * cascade in `provider.ts` only ever runs one tier per page per request, so two independent values for
 * the same field never coexist within a single fetch. A conflict here is always "new crawl disagrees with
 * what we already believed", never "JSON-LD disagreed with AI just now" (that page-internal case is
 * `structured-data.ts`'s own `priceConflict`, unrelated to this).
 */

export type FieldSource = Database["public"]["Enums"]["search_field_source"];

export const LISTING_FIELDS = [
  "name",
  "description",
  "price_minor",
  "currency",
  "guests",
  "cabins",
  "vessel_type_raw",
  "country",
  "city",
] as const;

export type ListingFieldName = (typeof LISTING_FIELDS)[number];
export type ListingFieldValue = string | number | null;

/** Per-field value types, matching the `search_extracted_listings` columns exactly (numeric fields stay
 *  `number`, never widen to the general `ListingFieldValue` union) — so a caller spreading
 *  `Partial<ListingFields>` into a typed Supabase `Update` gets the same per-column types the generated
 *  `database.types.ts` expects, instead of every field collapsing to `string | number | null`. */
export interface ListingFieldTypes {
  name: string;
  description: string;
  price_minor: number;
  currency: string;
  guests: number;
  cabins: number;
  vessel_type_raw: string;
  country: string;
  city: string;
}

export type ListingFields = { [K in ListingFieldName]: ListingFieldTypes[K] | null };

export interface FieldProvenanceEntry {
  source: FieldSource;
  /** 0.0-1.0, always set here — unlike the ephemeral `FieldProvenance` in `lib/search/offer.ts`, every
   *  field (deterministic or not) needs a starting confidence for conflicts to have something to lower
   *  (design doc §3.4). */
  confidence: number;
  retrievedAt: string;
  sourceUrl: string;
}

export type ListingFieldProvenance = Partial<Record<ListingFieldName, FieldProvenanceEntry>>;

export interface StoredListing {
  fields: Partial<ListingFields>;
  fieldProvenance: ListingFieldProvenance;
}

export interface IncomingExtraction {
  /** Only fields this extraction actually determined — `null`/absent means "no opinion", never "clear
   *  the existing value" (an extractor that couldn't find a field must never erase what a previous, more
   *  thorough extraction already established). */
  fields: Partial<ListingFields>;
  source: FieldSource;
  confidence: number;
  sourceUrl: string;
  retrievedAt: string;
}

export interface OpenConflict {
  id: string;
  newValue: ListingFieldValue;
}

export interface ConflictToRecord {
  field: ListingFieldName;
  previousValue: ListingFieldValue;
  newValue: ListingFieldValue;
  previousSource: FieldSource;
  newSource: FieldSource;
}

export interface ResolvedConflict {
  field: ListingFieldName;
  conflictId: string;
}

export interface MergeResult {
  fields: Partial<ListingFields>;
  fieldProvenance: ListingFieldProvenance;
  newConflicts: ConflictToRecord[];
  resolvedConflicts: ResolvedConflict[];
}

// A page's price rarely changes between two crawls of the *same* page, but rounding/rate noise does
// happen — tolerance keeps that from being logged as a conflict. No real fluctuation sample exists yet
// (design doc §5.3 leaves this open); 1%, floored at 100 minor units (one major unit in a 2-decimal
// currency), is a conservative starting point that a real conflict log can later tune.
const PRICE_TOLERANCE_MIN_MINOR = 100;
const PRICE_TOLERANCE_RATIO = 0.01;

function valuesEqual(field: ListingFieldName, previous: ListingFieldValue, next: ListingFieldValue): boolean {
  if (previous === null || next === null) return previous === next;
  if (field === "price_minor") {
    const tolerance = Math.max(PRICE_TOLERANCE_MIN_MINOR, Math.round(Math.abs(Number(previous)) * PRICE_TOLERANCE_RATIO));
    return Math.abs(Number(previous) - Number(next)) <= tolerance;
  }
  if (field === "guests" || field === "cabins") return previous === next;
  return String(previous).trim().toLowerCase() === String(next).trim().toLowerCase();
}

/** Confidence penalty for a field caught in an unconfirmed conflict (design doc §3.4/§27: never silently
 *  pick a value, but a disputed field should visibly rank below an undisputed one). Floored rather than
 *  zeroed — a single disagreement doesn't erase everything the previous extraction established. */
function lowerConfidence(confidence: number): number {
  return Math.max(0.1, Math.round((confidence - 0.3) * 100) / 100);
}

export function mergeExtractedListing(
  existing: StoredListing | null,
  openConflictsByField: Partial<Record<ListingFieldName, OpenConflict>>,
  incoming: IncomingExtraction,
): MergeResult {
  // A precise `Partial<ListingFields>` (one value type per named field) can't be *written* through a
  // loop variable typed as the general `ListingFieldName` union — TypeScript computes the intersection
  // of all fields' types for that write position (effectively `null | undefined`), not the union, a
  // known limitation of indexed assignment through a homomorphic mapped type. `fields` stays loosely
  // typed internally and is cast back to the precise shape at the end, once every write is done —
  // runtime correctness is guaranteed by construction (each value always originates from the matching
  // field of a properly-typed `ListingFields`), only the generic loop itself can't prove it statically.
  const fields: Partial<Record<ListingFieldName, ListingFieldValue>> = { ...existing?.fields };
  const fieldProvenance: ListingFieldProvenance = { ...existing?.fieldProvenance };
  const newConflicts: ConflictToRecord[] = [];
  const resolvedConflicts: ResolvedConflict[] = [];

  for (const field of LISTING_FIELDS) {
    const incomingValue = incoming.fields[field];
    if (incomingValue === null || incomingValue === undefined) continue; // no opinion — leave untouched

    const existingValue = existing?.fields[field] ?? null;
    const existingProvenance = existing?.fieldProvenance[field];

    const accept = () => {
      fields[field] = incomingValue;
      fieldProvenance[field] = {
        source: incoming.source,
        confidence: incoming.confidence,
        retrievedAt: incoming.retrievedAt,
        sourceUrl: incoming.sourceUrl,
      };
    };

    if (existingValue === null) {
      accept(); // fill-in, not a conflict — nothing to disagree with yet
      continue;
    }

    if (valuesEqual(field, existingValue, incomingValue)) {
      accept(); // confirmed — also refreshes recency/confidence even when the value is unchanged
      continue;
    }

    const openConflict = openConflictsByField[field];
    if (openConflict && valuesEqual(field, openConflict.newValue, incomingValue)) {
      // A second, independent crawl agrees with the previously-disputed value — design doc §3.2's
      // confirmation path. Accept it and close the conflict.
      accept();
      resolvedConflicts.push({ field, conflictId: openConflict.id });
      continue;
    }

    // Fresh, unconfirmed disagreement — keep the existing value, log both, and only lower confidence
    // (never overwrite silently, per rules doc §27).
    if (existingProvenance) {
      fieldProvenance[field] = { ...existingProvenance, confidence: lowerConfidence(existingProvenance.confidence) };
    }
    newConflicts.push({
      field,
      previousValue: existingValue,
      newValue: incomingValue,
      previousSource: existingProvenance?.source ?? incoming.source,
      newSource: incoming.source,
    });
  }

  return { fields: fields as Partial<ListingFields>, fieldProvenance, newConflicts, resolvedConflicts };
}
