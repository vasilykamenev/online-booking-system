import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Retention for `external_vessel_index` (docs/data-merger-provenance-design.md §5.1's open
 * question) — the table is written on every successful generic-provider extraction (P1) and never
 * chased by a cleanup job, so left alone it grows without bound.
 *
 * Deliberately much longer than `providers/generic/provider.ts`'s `INDEX_FRESHNESS_MS` (24h, P3's
 * read-side TTL): a row past that TTL already stops being *read* — P3 falls back to a live fetch,
 * which then rewrites it — so deleting it sooner wouldn't free storage any faster in practice, it
 * would only lose `listing-merge.ts`'s "compare against the last known value" continuity for a
 * source that goes quiet for a while (its next crawl would see no existing row and treat every field
 * as a fresh fill-in rather than a possible conflict). 90 days is a first approximation, not tuned
 * against real data (same caveat as the design doc's price-tolerance constant): a source genuinely
 * untouched that long has no active consumer for its cached listing data.
 */
export const INDEX_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

export interface IndexCleanupResult {
  deletedListings: number;
}

/**
 * Deletes `external_vessel_index` rows whose `last_extracted_at` is older than
 * `INDEX_RETENTION_MS`. `search_field_conflicts` rows for them cascade-delete via their FK
 * (`search_field_conflicts_listing_id_fkey`, `on delete cascade`) — no separate query needed.
 * Called from the cron route handler (`api/cron/cleanup-search-index`).
 */
export async function cleanupStaleListings(now: Date = new Date()): Promise<IndexCleanupResult> {
  const cutoff = new Date(now.getTime() - INDEX_RETENTION_MS).toISOString();
  const { data, error } = await createAdminClient()
    .from("external_vessel_index")
    .delete()
    .lt("last_extracted_at", cutoff)
    .select("id");
  if (error) throw error;
  return { deletedListings: data?.length ?? 0 };
}

/**
 * Э5's own retention note: a listing the indexer stops finding among a source's `selected` URLs
 * (sold, delisted, or a page that stopped parsing as one) isn't deleted the first time it goes
 * missing — `index/indexer.ts` only ever *advances* `last_seen_at` when a run actually re-confirms
 * the listing, never touches it otherwise, so age-since-last-seen is already a real "missing across
 * N consecutive runs" signal by construction. 30 days assumes the plan's own suggested 12-24h index
 * cadence, giving a listing dozens of chances to be re-confirmed before this ever fires — a much
 * shorter window than `INDEX_RETENTION_MS` above, which is about a whole *source* going quiet, not
 * one listing disappearing from an otherwise still-active one.
 */
export const GONE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export interface GoneCleanupResult {
  deletedGoneListings: number;
}

/** Physical deletion for a listing `last_seen_at` says has been gone for `GONE_RETENTION_MS` —
 *  the "отдельным редким job'ом" the plan calls for, distinct from `cleanupStaleListings` above
 *  (whole-source quiet) and from whatever *read-time* exclusion Э6's orchestrator eventually adds
 *  (this only ever runs after that would already have stopped surfacing the row in results). */
export async function cleanupGoneListings(now: Date = new Date()): Promise<GoneCleanupResult> {
  const cutoff = new Date(now.getTime() - GONE_RETENTION_MS).toISOString();
  const { data, error } = await createAdminClient()
    .from("external_vessel_index")
    .delete()
    .lt("last_seen_at", cutoff)
    .select("id");
  if (error) throw error;
  return { deletedGoneListings: data?.length ?? 0 };
}
