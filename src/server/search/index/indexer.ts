import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";
import { getSourceById } from "@/server/search/source-registry";
import { listAllSelectedUrls, recordFetchOutcome } from "@/server/search/registry/url-registry-sync";
import { recordExtraction, resultToListingFields, touchExtraction } from "@/server/search/registry/extracted-listings";
import { fetchWithCache } from "@/server/search/crawl/cached-fetch";
import { hashContent } from "@/server/search/crawl/page-cache";
import { extractBySelectors } from "@/server/search/providers/generic/extract-by-selectors";
import { extractJsonLdFields, extractBreadcrumbTrail } from "@/lib/search/structured-data";
import { extractPageSummary } from "@/lib/search/page-text";
import { classifyCandidatePage, type CandidateClassification } from "@/server/search/candidate-classifier";
import { getCachedClassification, cacheClassification } from "@/server/search/registry/extraction-cache";
import { normalizeGenericResult, type GenericExtractedFields } from "@/server/search/providers/generic/normalize";
import { recordBreadcrumbTrail } from "@/server/search/registry/source-breadcrumbs";
import { resolveLocationFromBreadcrumb } from "@/server/search/index/location-resolver";
import { normalizeVesselType, type VesselTypeAlias } from "@/lib/search/vocabulary/vessel-types";
import type { FieldSource } from "@/server/search/registry/listing-merge";
import { indexBrilionsSource } from "@/server/search/index/brilions-indexer";
import { type IndexRunResult, type RunOptions, emptyRunResult, throttle } from "@/server/search/index/shared";
import { isSourceCallAllowed, recordSourceFailure, recordSourceSuccess } from "@/server/search/resilience/source-health";
import { checkSourceStructureHealth } from "@/server/search/source-structure-health";
import { resolveVesselIdentity } from "@/server/search/identity/vessel-identity";
import { translateFieldsToEnglish } from "@/server/search/index/translate-fields";
import {
  bumpReindexProgress,
  cancelReindexProgress,
  finishReindexProgress,
  isCancelRequested,
  startReindexProgress,
} from "@/server/search/index/reindex-progress";
import { getReindexConcurrency, getReindexMaxDurationSeconds } from "@/server/queries/admin";

/**
 * The background counterpart to the live path's per-request sampling (Э5, Арх §12) — walks every
 * `selected` URL for one source and upserts what it finds into `external_vessel_index`, so a search
 * can eventually `select` from it instead of crawling live (Э6's job, not this one's).
 *
 * Reuses the same tiered extraction (selectors → JSON-LD → AI) as
 * `providers/generic/provider.ts`'s `fetchAndNormalize`, and writes through the same
 * `recordExtraction` merge/conflict machinery the live path already uses — a page visited by both
 * paths accumulates one consistent history, not two competing ones. Diverges from the live path in
 * exactly one place: location comes from `resolveLocationFromBreadcrumb` (resolved against the whole
 * `locations` vocabulary) rather than `structured-data.ts`'s `matchBreadcrumbLocation` (which only
 * confirms one specific query's wanted value) — there is no live query here to confirm against.
 */

// Mirrors `providers/generic/provider.ts`'s own `PAGE_CACHE_MS`/`SELECTOR_CONFIDENCE`/
// `JSON_LD_CONFIDENCE` constants — kept as a separate copy rather than an import, since those are
// that module's private implementation detail, not a shared contract between the two paths.
const PAGE_CACHE_MS = 24 * 60 * 60 * 1000;
const SELECTOR_CONFIDENCE = 0.95;
const JSON_LD_CONFIDENCE = 0.9;
/** `resolveLocationFromBreadcrumb`'s own confidence — an exact match against our own `locations`
 *  vocabulary, not a page-markup parse, so it earns a touch more trust than a bare `JSON_LD` field. */
const BREADCRUMB_CONFIDENCE = 0.95;

/** Global aliases (`source_id is null`) plus this source's own overrides — same precedence the Э1
 *  migration's seed comment describes for `vessel_type_aliases`. */
async function getVesselTypeAliases(sourceId: string): Promise<VesselTypeAlias[]> {
  const { data } = await createAdminClient()
    .from("vessel_type_aliases")
    .select("alias, vessel_type")
    .or(`source_id.is.null,source_id.eq.${sourceId}`);
  return (data ?? []).map((row) => ({ alias: row.alias, vesselType: row.vessel_type }));
}

/** Same persistent-then-model cascade as `providers/generic/provider.ts`'s `classifyCached`, minus
 *  that module's in-memory layer — a single indexer run over hundreds of URLs gets little from a
 *  process-lifetime cache that `getCachedClassification` doesn't already cover across runs. */
async function classifyForIndex(
  html: string,
): Promise<{ classification: CandidateClassification; usedAi: boolean }> {
  const key = hashContent(html);
  const persisted = await getCachedClassification(key).catch(() => null);
  if (persisted) return { classification: persisted, usedAi: false };

  const classification = await classifyCandidatePage(html);
  cacheClassification(key, classification).catch(() => {});
  return { classification, usedAi: true };
}

export type { IndexRunResult } from "@/server/search/index/shared";

/**
 * Generic-tier indexing (selectors → JSON-LD → AI, via `search_source_urls`'s URL Registry) — every
 * source except brilions.com, which has its own sitemap-and-extractor path
 * (`index/brilions-indexer.ts`) predating the URL Registry and needing none of this tiering (see
 * that module's own doc comment). `indexSource` below is the public entry point that picks between
 * the two; this one assumes its caller already resolved `source`.
 *
 * Never throws: one page's fetch/extraction failure is recorded (`recordFetchOutcome`) and skipped,
 * same "one broken source must not break the whole run" discipline as `VesselSourceAdapter.search()`.
 * A URL this pass never got a listing out of (fetch failed, or fetched but didn't classify as a
 * listing) simply doesn't get its `external_vessel_index.last_seen_at` refreshed — the "gone from
 * the source" signal a future retention sweep reads, with no separate bookkeeping needed for it.
 *
 * Processes `concurrency` candidates at a time (manual testing's speed-up request) rather than one
 * at a time — `throttle` still paces the actual network fetch to the source's configured rps (see
 * `rate-limiter.ts`'s `reservationChains`), but the slower post-fetch work (AI classification, DB
 * writes, identity resolution) now overlaps across candidates instead of blocking the next fetch.
 * Cancellation and the run's own time budget (`deadlineAt`) are both checked only *between* batches,
 * never mid-batch, and progress is only ever written at a batch boundary — see this function's own
 * batch loop for why that keeps Stop/Resume correct without any extra bookkeeping beyond what
 * `recordExtraction`'s idempotent upsert already gives.
 */
async function indexGenericSource(
  source: NonNullable<Awaited<ReturnType<typeof getSourceById>>>,
  { startFrom, concurrency, deadlineAt }: RunOptions,
): Promise<IndexRunResult> {
  const sourceId = source.id;
  const result = emptyRunResult(sourceId);

  const [allUrls, aliases] = await Promise.all([listAllSelectedUrls(sourceId), getVesselTypeAliases(sourceId)]);
  result.urlsConsidered = allUrls.length;
  // A resume (`startFrom > 0`) reuses the still-in-progress `started_at`/`total`/`processed` row that
  // `beginResume` already prepared — calling this again would reset `reindex_processed` to 0 and lose
  // the resume cursor. Only a genuinely fresh run (Э5's "Индексировать сейчас") resets progress.
  if (startFrom === 0) startReindexProgress(sourceId, allUrls.length).catch(() => {});
  const urls = allUrls.slice(startFrom);

  // `HTML` must stay free/deterministic (docs/search-source-processing-strategies.md §2) — same
  // rule `fetchAndNormalize`'s own `allowAi` follows.
  const allowAi = source.processingType !== "HTML";

  /** One candidate's full fetch→extract→write pipeline, awaited together with up to `concurrency-1`
   *  siblings by the batch loop below — unchanged from before batching except every early `continue`
   *  is now a `return` (this is a standalone unit, not a loop body) and it no longer touches
   *  cancellation or progress itself; those are the batch loop's job now, not each candidate's. */
  async function processCandidate(candidate: { id: string; url: string }): Promise<void> {
    // Э8: shared with `orchestrator/verification-phase.ts` now — see `resilience/rate-limiter.ts`'s
    // own doc comment. Safe to call concurrently for this same `sourceId` (`reservationChains`).
    await throttle(sourceId);

    const page = await fetchWithCache(candidate.url, PAGE_CACHE_MS);
    if (!page.ok || !page.html) {
      result.pagesFailed += 1;
      await recordFetchOutcome(candidate.id, {
        httpStatus: null,
        contentHash: null,
        crawlStatus: "FAILED",
        ranAi: false,
      });
      // Э8: a genuine fetch failure — not "fetched fine but wasn't a listing" — is exactly the
      // reachability signal the circuit breaker tracks. Fire-and-forget, same as this file's other
      // best-effort side writes (`recordBreadcrumbTrail`).
      recordSourceFailure(sourceId, `fetch failed: ${candidate.url}`).catch(() => {});
      return;
    }
    recordSourceSuccess(sourceId).catch(() => {});

    const contentHash = hashContent(page.html);

    if (page.contentUnchanged) {
      result.pagesUnchanged += 1;
      await recordFetchOutcome(candidate.id, { httpStatus: 200, contentHash, crawlStatus: "FETCHED", ranAi: false });
      await touchExtraction(sourceId, candidate.url, new Date().toISOString());
      return;
    }

    result.pagesFetched += 1;

    // Recorded unconditionally, independent of which tier ends up handling this page — same
    // reasoning as `fetchAndNormalize`'s own unconditional breadcrumb capture.
    const breadcrumbTrail = extractBreadcrumbTrail(page.html);
    if (breadcrumbTrail.length > 0) recordBreadcrumbTrail(sourceId, breadcrumbTrail).catch(() => {});
    const breadcrumbLabels = breadcrumbTrail.map((entry) => entry.name);

    let genericFields: GenericExtractedFields | null = null;
    let fieldSource: FieldSource | null = null;
    let confidence: number | null = null;
    let ranAi = false;

    if (source.selectorConfig) {
      const bySelectors = extractBySelectors(page.html, source.selectorConfig);
      if (bySelectors) {
        const image = bySelectors.image ?? extractPageSummary(page.html).image;
        genericFields = { ...bySelectors, image };
        fieldSource = "SELECTOR";
        confidence = SELECTOR_CONFIDENCE;
      }
    }

    if (!genericFields) {
      const structured = extractJsonLdFields(page.html);
      if (structured?.name) {
        genericFields = {
          name: structured.name,
          description: structured.description,
          image: structured.image,
          guests: null,
          cabins: null,
          vesselTypeRaw: null,
          country: null,
          city: null,
          price: structured.price,
          currency: structured.currency,
        };
        fieldSource = "JSON_LD";
        confidence = JSON_LD_CONFIDENCE;
      }
    }

    if (!genericFields && allowAi) {
      const { classification, usedAi } = await classifyForIndex(page.html);
      ranAi = usedAi;
      if (usedAi) result.aiCalls += 1;
      if (classification.looksLikeVesselListing) {
        const summary = extractPageSummary(page.html);
        genericFields = {
          name: classification.extracted.name ?? summary.heading,
          description: summary.description,
          image: summary.image,
          guests: classification.extracted.guests,
          cabins: classification.extracted.cabins,
          vesselTypeRaw: classification.extracted.vesselTypeRaw,
          country: classification.extracted.country,
          city: classification.extracted.city,
          price: null,
          currency: null,
        };
        fieldSource = "AI";
        confidence = classification.confidence;
      }
    }

    await recordFetchOutcome(candidate.id, { httpStatus: 200, contentHash, crawlStatus: "FETCHED", ranAi });

    if (!genericFields || !fieldSource || confidence === null) {
      return; // not a listing — nothing to index
    }

    // Index-wide English policy (translate-fields.ts's own doc comment) — layered on after
    // extraction, not folded into any tier above: extraction stays a verbatim record of what the
    // page said (provenance/confidence keep meaning "how sure are we this is what the page said",
    // not "how sure are we about the translation"), and a no-op for already-English text either way.
    genericFields = { ...genericFields, ...(await translateFieldsToEnglish(genericFields)) };

    const retrievedAt = new Date().toISOString();
    const resolvedLocation = await resolveLocationFromBreadcrumb(breadcrumbLabels).catch(() => null);

    const normalized = normalizeGenericResult({
      sourceUrl: candidate.url,
      sourceName: source.name,
      sourceDomain: source.domain,
      retrievedAt,
      fields: {
        ...genericFields,
        country: resolvedLocation?.country ?? genericFields.country,
        city: resolvedLocation?.city ?? genericFields.city,
      },
      aiConfidence: fieldSource === "AI" ? confidence : null,
    });

    const extracted = await recordExtraction({
      sourceId,
      url: candidate.url,
      fields: resultToListingFields(normalized),
      fieldSource,
      confidence,
      sourceUrl: candidate.url,
      retrievedAt,
      image: normalized.images[0]?.url ?? null,
    });

    // Fix (found live): a resolved breadcrumb location must never be tagged with the tier's own
    // `fieldSource` (typically `JSON_LD`) — `registry/listing-index.ts`'s stale-JSON-LD read guard
    // exists specifically for the *live* path's per-query breadcrumb confirmation
    // (`structured-data.ts`'s `matchBreadcrumbLocation`), and nulls country/city on every read for
    // any row carrying that tag. `resolveLocationFromBreadcrumb`'s result is a genuinely different,
    // non-query-scoped fact (that module's own doc comment) and needs its own source so that guard
    // leaves it alone — a second, immediately-following `recordExtraction` call overwrites just these
    // two fields' provenance via the ordinary "confirmed, same value" merge path (the value itself
    // already went into `normalized`/the call above; this only corrects who gets credited for it).
    // Observed effect of not doing this: every location-scoped search against a source whose location
    // comes from structured data (any `STRUCTURED_DATA`-strategy source) silently returned zero
    // external candidates — `matchesKnownCriteria`'s hard "no location at all" filter saw a
    // read-time-wiped-to-null location on every single row.
    if (resolvedLocation?.country || resolvedLocation?.city) {
      await recordExtraction({
        sourceId,
        url: candidate.url,
        fields: { country: resolvedLocation.country, city: resolvedLocation.city },
        fieldSource: "BREADCRUMB",
        confidence: BREADCRUMB_CONFIDENCE,
        sourceUrl: candidate.url,
        retrievedAt,
        image: null,
      });
    }

    // `recordExtraction` owns the legacy flat comparison columns + provenance/conflicts above —
    // this only fills the Э5-only columns it doesn't touch.
    await createAdminClient()
      .from("external_vessel_index")
      .update({
        vessel_type: normalizeVesselType(genericFields.vesselTypeRaw, aliases),
        marina: resolvedLocation?.marina ?? null,
        latitude: resolvedLocation?.latitude ?? null,
        longitude: resolvedLocation?.longitude ?? null,
        images: normalized.images as unknown as Json,
        extracted: normalized as unknown as Json,
        content_hash: contentHash,
      })
      .eq("source_id", sourceId)
      .eq("url", candidate.url);

    // Э11 (Арх §17): best-effort, never throws — see `resolveVesselIdentity`'s own doc comment.
    if (extracted) await resolveVesselIdentity(extracted.id, normalized);

    result.listingsIndexed += 1;
  }

  // Cancellation is checked only between batches — a batch either completes fully or never starts,
  // so `reindex_processed` after a Stop is always "every page up to here is genuinely done", and
  // Resume's `startFrom` (that same number) never has to skip or double-check a partially-finished
  // batch. `Promise.allSettled` (not `Promise.all`): one candidate's unexpected throw must not lose
  // the rest of its batch — matches this function's own "one broken page must not break the whole
  // run" discipline, and `processCandidate` already routes every *expected* failure through its own
  // `result.pagesFailed`/`recordFetchOutcome` bookkeeping rather than throwing.
  for (let batchStart = 0; batchStart < urls.length; batchStart += concurrency) {
    // Deadline check alongside cancellation: both stop the run the same way (`cancelReindexProgress`
    // — resumable, distinguished in the DB by `cancelReindexProgress`'s `reason` (the admin UI's
    // auto-resume needs to tell "stopped by deadline" apart from "stopped by manual Stop" — only the
    // former should resume itself). Deadline checked first since a cheap `Date.now()` comparison
    // should never wait on the `isCancelRequested` round-trip.
    const deadlineHit = Date.now() >= deadlineAt;
    if (deadlineHit || (await isCancelRequested(sourceId))) {
      await cancelReindexProgress(sourceId, startFrom + batchStart, deadlineHit ? "deadline" : "cancelled");
      return result;
    }

    const batch = urls.slice(batchStart, batchStart + concurrency);
    await Promise.allSettled(batch.map((candidate) => processCandidate(candidate)));

    await bumpReindexProgress(sourceId, startFrom + batchStart + batch.length);
  }

  await finishReindexProgress(sourceId, allUrls.length);
  return result;
}

/** Domain → its own indexing path, mirroring `adapters/adapter-registry.ts`'s
 *  `ADAPTER_FACTORIES_BY_DOMAIN` — a domain listed here has a bespoke crawl/extraction pipeline
 *  that doesn't go through the URL Registry at all, same reasoning as that map. */
const DOMAIN_INDEXERS: Record<string, (sourceId: string, options: RunOptions) => Promise<IndexRunResult>> = {
  "brilions.com": indexBrilionsSource,
};

/**
 * Public entry point (Э5) — the cron route and the admin "Индексировать сейчас" action both call
 * this, never `indexGenericSource` directly, so a bespoke source's own path is never bypassed by
 * accident. `null` for an unknown id degrades to an empty result rather than throwing — same
 * "never break the caller's run over one source" discipline as everything else in this module.
 *
 * Э8: checked once here, before dispatching to either indexing path, rather than inside each one —
 * an open breaker means "don't crawl this source at all right now" at the whole-run level, not a
 * per-page decision. A skipped run simply leaves the existing index rows as they are (still served
 * by the read path, just not refreshed this cycle) — never an error the cron route needs to handle.
 */
export async function indexSource(sourceId: string, options?: { startFrom?: number }): Promise<IndexRunResult> {
  const source = await getSourceById(sourceId);
  if (!source) return emptyRunResult(sourceId);
  if (!(await isSourceCallAllowed(sourceId))) return emptyRunResult(sourceId);

  // Both read fresh on every run (not cached) — an admin's edit to either setting on
  // `/admin/search-sources` takes effect on the very next reindex, no redeploy needed.
  const [concurrency, maxDurationSeconds] = await Promise.all([
    getReindexConcurrency(),
    getReindexMaxDurationSeconds(),
  ]);
  const runOptions: RunOptions = {
    startFrom: options?.startFrom ?? 0,
    concurrency,
    deadlineAt: Date.now() + maxDurationSeconds * 1000,
  };
  const domainIndexer = DOMAIN_INDEXERS[source.domain];
  const result = await (domainIndexer ? domainIndexer(sourceId, runOptions) : indexGenericSource(source, runOptions));

  // Э10 (Арх §19): piggybacks on the indexer's own cadence — checked here, not on every live search
  // request. Best-effort and never awaited-into-failure: `checkSourceStructureHealth` already
  // swallows its own errors, but the run's result must reach the caller (the cron job, the admin's
  // "Индексировать сейчас" button) either way.
  await checkSourceStructureHealth(sourceId);

  return result;
}
