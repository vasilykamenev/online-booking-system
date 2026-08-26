import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";
import type { VesselSearchResult } from "@/lib/search/result";
import {
  LISTING_FIELDS,
  mergeExtractedListing,
  type FieldSource,
  type ListingFieldName,
  type ListingFieldProvenance,
  type ListingFields,
  type ListingFieldValue,
  type OpenConflict,
  type StoredListing,
} from "@/server/search/registry/listing-merge";

/**
 * I/O wrapper around `listing-merge.ts` (design doc §3, phase P1+P2) — reads the last persisted state
 * of a `(source, url)` listing, folds in a fresh extraction, and writes the result plus any newly
 * detected or resolved conflicts. Runs with the service-role client: called from live (anonymous-allowed)
 * search traffic, same reasoning as `url-registry-sync.ts`'s `recordFetchOutcome`.
 *
 * Purely additive today (P1): nothing in the live search response path reads this table back — see
 * `providers/generic/provider.ts`'s call site. A write failure here must never surface as a search
 * failure, so every caller is expected to `.catch(() => {})` this, matching `recordFetchOutcome`.
 */

/** Maps the canonical result shape onto the DB's flatter, comparison-friendly column set — only the
 *  fields this design tracks provenance/conflicts for (design doc §3.1); everything else in
 *  `VesselSearchResult` (images, availability, ratings, ...) is out of scope for this table. */
export function resultToListingFields(result: VesselSearchResult): Partial<ListingFields> {
  return {
    name: result.name,
    description: result.description,
    price_minor: result.rental.priceMinor,
    currency: result.rental.currency,
    guests: result.capacity.guests,
    cabins: result.capacity.cabins,
    vessel_type_raw: result.vesselTypeRaw,
    country: result.location.country,
    city: result.location.city,
  };
}

export interface RecordExtractionInput {
  sourceId: string;
  url: string;
  fields: Partial<ListingFields>;
  fieldSource: FieldSource;
  confidence: number;
  sourceUrl: string;
  retrievedAt: string;
  /** Plain last-write-wins, unlike every field in `fields` — an image URL changing isn't a
   *  meaningful conflict to log, so this bypasses `mergeExtractedListing` entirely (design doc
   *  §4 P3's `listing-index.ts` doc comment explains why the index needs one at all). `null`
   *  ("no opinion") leaves the previously stored image untouched, same convention as every other
   *  field. */
  image: string | null;
}

interface ListingRow {
  id: string;
  name: string | null;
  description: string | null;
  price_minor: number | null;
  currency: string | null;
  guests: number | null;
  cabins: number | null;
  vessel_type_raw: string | null;
  country: string | null;
  city: string | null;
  field_provenance: ListingFieldProvenance;
}

function rowToStoredListing(row: ListingRow): StoredListing {
  // See the equivalent comment in `listing-merge.ts`'s `mergeExtractedListing` — writing a precise
  // per-field type through a loop variable typed as the general `ListingFieldName` union doesn't type-check.
  const fields: Partial<Record<ListingFieldName, ListingFieldValue>> = {};
  for (const field of LISTING_FIELDS) fields[field] = row[field];
  return { fields: fields as Partial<ListingFields>, fieldProvenance: row.field_provenance ?? {} };
}

export async function recordExtraction(input: RecordExtractionInput): Promise<void> {
  const supabase = createAdminClient();

  const { data: existingRow } = await supabase
    .from("search_extracted_listings")
    .select("id, name, description, price_minor, currency, guests, cabins, vessel_type_raw, country, city, field_provenance")
    .eq("source_id", input.sourceId)
    .eq("url", input.url)
    .maybeSingle();

  const openConflictsByField: Partial<Record<ListingFieldName, OpenConflict>> = {};
  if (existingRow) {
    const { data: openConflicts } = await supabase
      .from("search_field_conflicts")
      .select("id, field, new_value")
      .eq("listing_id", existingRow.id)
      .is("resolved_at", null)
      // Ascending so that if a field somehow has more than one open conflict (a third, still-different
      // extraction before the first was ever confirmed), the loop below keeps the most recently
      // detected one — the freshest dispute is the relevant one to compare a new extraction against.
      .order("detected_at", { ascending: true });
    for (const conflict of openConflicts ?? []) {
      openConflictsByField[conflict.field as ListingFieldName] = {
        id: conflict.id,
        newValue: conflict.new_value as ListingFields[ListingFieldName],
      };
    }
  }

  const merged = mergeExtractedListing(
    existingRow ? rowToStoredListing(existingRow as ListingRow) : null,
    openConflictsByField,
    {
      fields: input.fields,
      source: input.fieldSource,
      confidence: input.confidence,
      sourceUrl: input.sourceUrl,
      retrievedAt: input.retrievedAt,
    },
  );

  const { data: upserted } = await supabase
    .from("search_extracted_listings")
    .upsert(
      {
        source_id: input.sourceId,
        url: input.url,
        ...merged.fields,
        ...(input.image !== null ? { image: input.image } : {}),
        field_provenance: merged.fieldProvenance as Json,
        last_extracted_at: input.retrievedAt,
      },
      { onConflict: "source_id,url" },
    )
    .select("id")
    .single();

  if (!upserted) return; // best-effort — a failed upsert leaves both conflict lists moot

  if (merged.newConflicts.length > 0) {
    await supabase.from("search_field_conflicts").insert(
      merged.newConflicts.map((conflict) => ({
        listing_id: upserted.id,
        field: conflict.field,
        previous_value: conflict.previousValue,
        new_value: conflict.newValue,
        previous_source: conflict.previousSource,
        new_source: conflict.newSource,
      })),
    );
  }

  for (const resolved of merged.resolvedConflicts) {
    await supabase
      .from("search_field_conflicts")
      .update({ resolved_at: new Date().toISOString(), resolution: "kept_new" })
      .eq("id", resolved.conflictId);
  }
}

/**
 * Bumps `last_extracted_at` only — no field or provenance change, no conflict comparison — after a
 * `304 Not Modified` (design doc §5.4) confirms an otherwise-stale listing's page hasn't actually
 * changed. Distinct from `recordExtraction`: nothing new was learned this crawl, so there is nothing
 * to merge or compare, only the row's freshness to extend.
 */
export async function touchExtraction(sourceId: string, url: string, retrievedAt: string): Promise<void> {
  await createAdminClient()
    .from("search_extracted_listings")
    .update({ last_extracted_at: retrievedAt })
    .eq("source_id", sourceId)
    .eq("url", url);
}
