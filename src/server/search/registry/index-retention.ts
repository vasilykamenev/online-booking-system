import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Retention for `search_extracted_listings` (docs/data-merger-provenance-design.md §5.1's open
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
 * Deletes `search_extracted_listings` rows whose `last_extracted_at` is older than
 * `INDEX_RETENTION_MS`. `search_field_conflicts` rows for them cascade-delete via their FK
 * (`search_field_conflicts_listing_id_fkey`, `on delete cascade`) — no separate query needed.
 * Called from the cron route handler (`api/cron/cleanup-search-index`).
 */
export async function cleanupStaleListings(now: Date = new Date()): Promise<IndexCleanupResult> {
  const cutoff = new Date(now.getTime() - INDEX_RETENTION_MS).toISOString();
  const { data, error } = await createAdminClient()
    .from("search_extracted_listings")
    .delete()
    .lt("last_extracted_at", cutoff)
    .select("id");
  if (error) throw error;
  return { deletedListings: data?.length ?? 0 };
}
