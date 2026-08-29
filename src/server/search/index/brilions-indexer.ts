import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";
import {
  resolveRobotsAllowed,
  loadSitemapEntries,
  fetchAndNormalize,
} from "@/server/search/providers/brilions/provider";
import { recordExtraction, resultToListingFields } from "@/server/search/registry/extracted-listings";
import { type IndexRunResult, emptyRunResult, throttle } from "@/server/search/index/shared";
import { recordSourceFailure, recordSourceSuccess } from "@/server/search/resilience/source-health";
import { resolveVesselIdentity } from "@/server/search/identity/vessel-identity";

/**
 * Brilions' own indexing path (Э5) — every sitemap entry, not a criteria-matched sample. Reuses
 * `providers/brilions/provider.ts`'s `fetchAndNormalize` as-is: unlike the generic path
 * (`index/indexer.ts`), brilions' extraction is already fully self-contained per page —
 * `normalizeBrilionsResult` resolves country (from the sitemap's `citySlugGuess`) and vessel type
 * (from the page's own raw type text) unconditionally, with no live query to confirm against, so
 * there is no separate location-resolution step to write here the way the generic path needed
 * `location-resolver.ts` for.
 *
 * No `search_source_urls`/URL Registry involvement: brilions never populated that table (its own
 * sitemap parse is the whole discovery mechanism), so there is no `recordFetchOutcome` bookkeeping
 * to do either — nothing reads that table for this domain.
 */
export async function indexBrilionsSource(sourceId: string): Promise<IndexRunResult> {
  const result = emptyRunResult(sourceId);

  const allowed = await resolveRobotsAllowed();
  if (!allowed) return result;

  const entries = await loadSitemapEntries();
  if (!entries) return result;
  result.urlsConsidered = entries.length;

  for (const entry of entries) {
    // Э8: shared with the generic indexer and live verification now — see
    // `resilience/rate-limiter.ts`'s own doc comment.
    await throttle(sourceId);

    const { result: normalized, usedAi, contentHash } = await fetchAndNormalize(entry, {
      locale: "ru",
      searchQueries: [],
      timeoutMs: 30_000,
    });
    if (usedAi) result.aiCalls += 1;

    if (!normalized) {
      result.pagesFailed += 1;
      recordSourceFailure(sourceId, `fetch failed: ${entry.urlRu}`).catch(() => {});
      continue;
    }
    recordSourceSuccess(sourceId).catch(() => {});
    result.pagesFetched += 1;

    const pageUrl = normalized.source.url;
    const retrievedAt = normalized.source.retrievedAt;

    // "SELECTOR", not "AI": brilions' own `extractDeterministic` is a hardcoded, deterministic
    // per-page parser (in spirit, the site-specific equivalent of an admin's `selectorConfig`) —
    // only its *amenities* extraction calls a model (`amenitiesCache`/`extractAmenitiesWithAi`,
    // tracked separately via `usedAi` above), and that path already carries its own provenance on
    // `normalized.fieldProvenance` rather than through `recordExtraction`'s single fieldSource.
    const extracted = await recordExtraction({
      sourceId,
      url: pageUrl,
      fields: resultToListingFields(normalized),
      fieldSource: "SELECTOR",
      confidence: 0.95,
      sourceUrl: pageUrl,
      retrievedAt,
      image: normalized.images[0]?.url ?? null,
    });

    await createAdminClient()
      .from("external_vessel_index")
      .update({
        // Already resolved unconditionally by `normalizeBrilionsResult` (citySlugGuess → country,
        // raw type text → enum) — no separate alias lookup needed the way the generic path's
        // `normalizeVesselType` call requires.
        vessel_type: normalized.vesselType,
        marina: normalized.location.marina,
        latitude: normalized.location.latitude,
        longitude: normalized.location.longitude,
        images: normalized.images as unknown as Json,
        extracted: normalized as unknown as Json,
        content_hash: contentHash,
      })
      .eq("source_id", sourceId)
      .eq("url", pageUrl);

    // Э11 (Арх §17): best-effort, never throws — see `resolveVesselIdentity`'s own doc comment.
    if (extracted) await resolveVesselIdentity(extracted.id, normalized);

    result.listingsIndexed += 1;
  }

  return result;
}
