import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SearchCriteria } from "@/lib/search/criteria";
import type { VesselSearchResult } from "@/lib/search/result";
import { matchesKnownCriteria } from "@/lib/search/match-criteria";
import { extractJsonLdFields } from "@/lib/search/structured-data";
import { extractPageSummary } from "@/lib/search/page-text";
import { fetchWithCache } from "@/server/search/crawl/cached-fetch";
import { fetchRobotsInfo, type RobotsInfo } from "@/server/search/crawl/robots";
import { isAllowedByRobots } from "@/server/search/crawl/robots-rules";
import { FALLBACK_SITEMAP_PATHS, MAX_SITEMAP_CANDIDATES } from "@/server/search/crawl/sitemap-discovery";
import { looksLikeSitemap, sampleSitemapLocs } from "@/server/search/crawl/sitemap-rules";
import { hashContent } from "@/server/search/crawl/page-cache";
import { classifyCandidatePage, type CandidateClassification } from "@/server/search/candidate-classifier";
import {
  selectCandidatesFromRegistry,
  recordFetchOutcome,
} from "@/server/search/registry/url-registry-sync";
import { recordExtraction, resultToListingFields } from "@/server/search/registry/extracted-listings";
import type { FieldSource } from "@/server/search/registry/listing-merge";
import { selectGenericCandidates } from "@/server/search/providers/generic/select-candidates";
import { normalizeGenericResult } from "@/server/search/providers/generic/normalize";
import { extractBySelectors } from "@/server/search/providers/generic/extract-by-selectors";
import type { SearchSource } from "@/server/search/source-registry";
import {
  emptyExternalStats,
  type ExternalSearchContext,
  type ExternalSearchOutcome,
  type ExternalSearchProvider,
  type ExternalSearchStats,
} from "@/server/search/providers";

/**
 * `ExternalSearchProvider` factory for any registered source with no purpose-built implementation
 * registered in `PROVIDERS_BY_DOMAIN` (`provider-registry.ts`) that `isGenericEligible` there
 * accepts — `AI_EXTRACTION`/`STRUCTURED_DATA` always, `HTML`/`HYBRID` once an admin has filled in
 * `selectorConfig` (docs/search-source-processing-strategies.md §1.1). This is the piece that makes
 * `/admin/search-sources` registration actually *real-time*: approving a source is enough to start
 * searching it, no provider code or deploy required. See `src/server/search/README.md`.
 *
 * ## Why this can't pre-filter by location like `providers/brilions/`
 *
 * brilions' provider only ever fetches pages it has a specific reason to believe match — a
 * hand-built city-slug dictionary lets it skip everything outside the requested location before
 * fetching a single page. A generic provider has no such dictionary for an arbitrary site: there is
 * no reliable, site-agnostic way to know what a sitemap URL's slug means. So candidate selection
 * here (`select-candidates.ts`) is a location-blind, evenly-spaced sample of the sitemap, and
 * relevance is judged **after** fetching — `matchesKnownCriteria` for capacity/type, same as every
 * other provider — never before.
 *
 * ## Why this leans on AI far more than brilions
 *
 * Without site-specific selectors, there's no deterministic way to read a page's fields. The best
 * available signal, tried first and free, is the page's own JSON-LD (`extractJsonLdFields`); every
 * other page falls back to `classifyCandidatePage` — one Anthropic call. That makes this provider's
 * real per-search throughput far lower than brilions' — a handful of pages within
 * `context.timeoutMs`, not dozens — since most of the time budget goes to the AI call
 * (`AI_CALL_TIMEOUT_MS`, up to 8s) rather than the fetch itself. Acceptable for a v1 built to remove
 * the "needs a deploy" blocker, not to match a hand-tuned provider's coverage.
 */

const PAGE_CACHE_MS = 24 * 60 * 60 * 1000;
const SITEMAP_CACHE_MS = 24 * 60 * 60 * 1000; // Same "changes by the week" assumption as brilions.
// How many raw sitemap entries are even worth reading into memory before `selectGenericCandidates`
// picks an even sample from them — a safety cap against a pathologically large sitemap, not the
// real fetch budget (that's `MAX_CANDIDATE_POOL` below).
const RAW_ENTRY_CAP = 500;
// Far smaller than brilions' 60 — most of the time budget here goes to AI calls, not fetches, so
// queuing more candidates than could plausibly be reached before `context.timeoutMs` just wastes
// the sampling step's own work.
const MAX_CANDIDATE_POOL = 20;
// Lower than brilions' 5 — each worker may be waiting on an up-to-8s AI call, not just a page
// fetch, so fewer of them keep concurrent Anthropic spend (and load on the target site) in check.
const FETCH_CONCURRENCY = 3;

/** Fixed confidence for deterministic tiers (design doc data-merger-provenance-design.md §3.4) — not a
 *  model score, just where each tier ranks relative to the others when a `search_extracted_listings`
 *  field later needs a starting point to lower on conflict. AI's confidence is `classification.confidence`
 *  instead, read as-is. */
const SELECTOR_CONFIDENCE = 0.95;
const JSON_LD_CONFIDENCE = 0.9;

/**
 * In-process cache of AI classification, keyed by page-content hash — same pattern and same reason
 * as brilions' `amenitiesCache` (survives one warm process, cuts repeat Anthropic spend for
 * byte-identical pages seen again within it). Module-level, not inside `createGenericProvider`'s
 * closure: that factory runs fresh for every active generic source on every request
 * (`provider-registry.ts`), so a cache scoped to its closure would never actually warm up.
 */
const classificationCache = new Map<string, CandidateClassification>();

async function classifyCached(
  html: string,
): Promise<{ classification: CandidateClassification; usedAi: boolean }> {
  const key = hashContent(html);
  const cached = classificationCache.get(key);
  if (cached) return { classification: cached, usedAi: false };

  const classification = await classifyCandidatePage(html);
  classificationCache.set(key, classification);
  return { classification, usedAi: true };
}

/**
 * Whether this source's robots.txt currently permits its own base path — cached on
 * `search_sources`, same pattern as `providers/brilions/provider.ts`'s `resolveRobotsAllowed`, but
 * checked against `/` rather than a site-specific detail path: unlike brilions, there is no known
 * path pattern to check instead, and `/` is genuinely representative of what this provider fetches.
 * `source.robotsAllows` is trusted directly rather than re-queried — unlike brilions (a static
 * provider with no source row of its own to read), this factory already received a fresh row from
 * `listEnabledSources()` this same request.
 */
async function resolveRobotsAllowed(source: SearchSource, robotsInfo: RobotsInfo): Promise<boolean> {
  if (source.robotsAllows !== null) return source.robotsAllows;

  const allowed = robotsInfo.found ? isAllowedByRobots(robotsInfo.rules, "/") : false;
  await createAdminClient()
    .from("search_sources")
    .update({ robots_allows: allowed, last_checked_at: new Date().toISOString() })
    .eq("id", source.id);
  return allowed;
}

/** Same declared-sitemap-then-fallback-paths search as `crawl/sitemap-discovery.ts`'s
 *  `discoverSitemap`, but through `fetchWithCache` — a live search repeats this on every request,
 *  unlike the one-off registration preview `discoverSitemap` was written for, so it needs the same
 *  24h page cache candidate detail pages already get. */
async function loadCachedSitemap(
  origin: string,
  robotsInfo: RobotsInfo,
): Promise<{ url: string; xml: string } | null> {
  const candidates = (
    robotsInfo.sitemapUrls.length > 0
      ? robotsInfo.sitemapUrls
      : FALLBACK_SITEMAP_PATHS.map((path) => `${origin}${path}`)
  ).slice(0, MAX_SITEMAP_CANDIDATES);

  for (const url of candidates) {
    const fetched = await fetchWithCache(url, SITEMAP_CACHE_MS);
    if (fetched.ok && fetched.html && looksLikeSitemap(fetched.html)) {
      return { url, xml: fetched.html };
    }
  }
  return null;
}

interface FetchedCandidate {
  result: VesselSearchResult | null;
  usedAi: boolean;
  /** Whether the underlying page fetch itself succeeded — independent of whether extraction found a
   *  usable listing. Feeds `search_source_urls.crawl_status` when this candidate came from the
   *  registry (spec §3: crawl_status tracks the fetch step, not extraction). */
  pageOk: boolean;
  contentHash: string | null;
  /** A non-fatal observation worth surfacing in the search run's `errors` — currently only "this
   *  page's own JSON-LD disagreed with itself about price" (`structured-data.ts`'s `priceConflict`,
   *  docs/SEO_Web_Discovery_JSON_LD_Project_Rules.md §27: "не должна молча выбирать одно значение").
   *  Never affects the result itself, which already omits the disputed price. */
  note: string | null;
  /** Which tier produced `result`, `null` when there is none — feeds `search_extracted_listings`'
   *  per-field provenance (design doc §3.4). `null` result and `null` fieldSource always travel
   *  together. */
  fieldSource: FieldSource | null;
  /** 0.0-1.0, paired with `fieldSource` — fixed per deterministic tier, or the AI classifier's own
   *  score. Meaningless when `fieldSource` is `null`. */
  confidence: number | null;
}

async function fetchAndNormalize(
  url: string,
  source: SearchSource,
  allowAi: boolean,
): Promise<FetchedCandidate> {
  const page = await fetchWithCache(url, PAGE_CACHE_MS);
  if (!page.ok || !page.html) {
    return { result: null, usedAi: false, pageOk: false, contentHash: null, note: null, fieldSource: null, confidence: null };
  }
  const contentHash = hashContent(page.html);

  const retrievedAt = new Date().toISOString();

  // Selectors first, when configured (tier 0, cheapest and most precise — an admin told us exactly
  // where this source's fields live) — before JSON-LD, since a hand-picked selector for a page that
  // also happens to publish JSON-LD should still win.
  if (source.selectorConfig) {
    const bySelectors = extractBySelectors(page.html, source.selectorConfig);
    if (bySelectors) {
      // `og:image` fallback when the config has no (or a non-matching) `image` selector — every
      // other tier below gets a photo "for free" this way (JSON-LD's own `image`, or
      // `extractPageSummary`'s `og:image` read in the AI tier), and an admin who only wrote
      // selectors for name/guests/cabins shouldn't lose photos entirely as a result.
      const image = bySelectors.image ?? extractPageSummary(page.html).image;
      const result = normalizeGenericResult({
        sourceUrl: url,
        sourceName: source.name,
        sourceDomain: source.domain,
        retrievedAt,
        fields: { ...bySelectors, image },
        aiConfidence: null,
      });
      return { result, usedAi: false, pageOk: true, contentHash, note: null, fieldSource: "SELECTOR", confidence: SELECTOR_CONFIDENCE };
    }
  }

  // JSON-LD next (spec §11: structured data before AI) — free, and more reliable than a model
  // reading prose, when the page actually publishes it.
  const structured = extractJsonLdFields(page.html);
  if (structured?.name) {
    const result = normalizeGenericResult({
      sourceUrl: url,
      sourceName: source.name,
      sourceDomain: source.domain,
      retrievedAt,
      fields: {
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
      },
      aiConfidence: null,
    });
    const note = structured.priceConflict
      ? `${source.domain}: ${url}: JSON-LD price conflict across listing blocks — price dropped`
      : null;
    return { result, usedAi: false, pageOk: true, contentHash, note, fieldSource: "JSON_LD", confidence: JSON_LD_CONFIDENCE };
  }

  // Pure `HTML` promises a fast, free, deterministic strategy (docs/search-source-processing-strategies.md
  // §2) — spending an AI call here would break that promise, so a source stuck on `HTML` whose
  // selectors and JSON-LD both missed this page simply yields no result for it, same as if it had no
  // generic path at all. `HYBRID` (and `AI_EXTRACTION`/`STRUCTURED_DATA`, which never reach this
  // branch with `allowAi: false`) fall through to AI as before.
  if (!allowAi) return { result: null, usedAi: false, pageOk: true, contentHash, note: null, fieldSource: null, confidence: null };

  const { classification, usedAi } = await classifyCached(page.html);
  if (!classification.looksLikeVesselListing) {
    return { result: null, usedAi, pageOk: true, contentHash, note: null, fieldSource: null, confidence: null };
  }

  // `og:image` is read deterministically rather than asked of the model — an AI-stated image URL
  // risks being invented/malformed in a way a `<meta>` tag simply can't be.
  const summary = extractPageSummary(page.html);
  const result = normalizeGenericResult({
    sourceUrl: url,
    sourceName: source.name,
    sourceDomain: source.domain,
    retrievedAt,
    fields: {
      name: classification.extracted.name ?? summary.heading,
      description: summary.description,
      image: summary.image,
      guests: classification.extracted.guests,
      cabins: classification.extracted.cabins,
      vesselTypeRaw: classification.extracted.vesselTypeRaw,
      country: classification.extracted.country,
      city: classification.extracted.city,
      // Not asked of the model (docs/SEO_Web_Discovery_JSON_LD_Project_Rules.md §33 keeps this out
      // of scope for now — JSON-LD is the only price source today, see this tier's own doc comment).
      price: null,
      currency: null,
    },
    aiConfidence: classification.confidence,
  });
  return { result, usedAi, pageOk: true, contentHash, note: null, fieldSource: "AI", confidence: classification.confidence };
}

interface Candidate {
  url: string;
  /** Present when this candidate came from `search_source_urls` (spec §3) rather than the sitemap
   *  fallback sample below — lets the worker write the fetch outcome back onto its registry row. */
  registryRowId?: string;
}

/**
 * Fetches `candidates` with up to `FETCH_CONCURRENCY` requests in flight, stopping before starting
 * the next one once `deadline` passes — same fixed-size-worker-pool shape as
 * `providers/brilions/provider.ts`'s `fetchCandidates`, for the same reason: a batch would let one
 * slow page (a cold fetch plus an AI call) stall every other worker in its batch.
 */
async function fetchCandidates(
  candidates: Candidate[],
  criteria: SearchCriteria,
  source: SearchSource,
  allowAi: boolean,
  context: ExternalSearchContext,
  deadline: number,
  stats: ExternalSearchStats,
  errors: string[],
): Promise<VesselSearchResult[]> {
  const results: VesselSearchResult[] = [];
  let nextIndex = 0;
  let stoppedForDeadline = false;

  async function worker(): Promise<void> {
    for (;;) {
      if (context.signal?.aborted || Date.now() > deadline) {
        stoppedForDeadline = true;
        return;
      }
      const index = nextIndex++;
      if (index >= candidates.length) return;
      const { url, registryRowId } = candidates[index];

      try {
        const { result, usedAi, pageOk, contentHash, note, fieldSource, confidence } = await fetchAndNormalize(
          url,
          source,
          allowAi,
        );
        stats.pagesVisited += 1;
        if (usedAi) stats.aiCalls += 1;
        if (note) errors.push(note);
        if (result) {
          stats.offersExtracted += 1;
          if (matchesKnownCriteria(result, criteria)) results.push(result);
          if (fieldSource && confidence !== null) {
            // Best-effort, additive persistence (design doc data-merger-provenance-design.md phase P1) —
            // never read back by this same request, so a failure here must never affect the response.
            recordExtraction({
              sourceId: source.id,
              url,
              fields: resultToListingFields(result),
              fieldSource,
              confidence,
              sourceUrl: url,
              retrievedAt: result.source.retrievedAt,
            }).catch(() => {});
          }
        }
        if (registryRowId) {
          // Best-effort — closes the loop `crawl_status: PENDING → FETCHED/FAILED` (spec §3) for
          // real search traffic without a dedicated background fetch job. Never lets a write
          // failure surface as a search failure.
          recordFetchOutcome(registryRowId, {
            crawlStatus: pageOk ? "FETCHED" : "FAILED",
            httpStatus: null,
            contentHash,
            ranAi: usedAi,
          }).catch(() => {});
        }
      } catch (error) {
        errors.push(`${source.domain}: ${url}: ${String(error)}`);
      }
    }
  }

  const workerCount = Math.min(FETCH_CONCURRENCY, candidates.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  if (stoppedForDeadline) errors.push(`${source.domain}: stopped early — time budget exhausted`);

  return results;
}

function buildRunSearch(source: SearchSource) {
  return async function runSearch(
    criteria: SearchCriteria,
    context: ExternalSearchContext,
  ): Promise<ExternalSearchOutcome> {
    const stats: ExternalSearchStats = { ...emptyExternalStats };
    const errors: string[] = [];
    const deadline = Date.now() + context.timeoutMs;

    const robotsInfo = await fetchRobotsInfo(source.baseUrl);
    const allowed = await resolveRobotsAllowed(source, robotsInfo);
    if (!allowed) {
      errors.push(`${source.domain}: robots.txt disallows / — skipping`);
      return { results: [], stats, errors };
    }

    // URL Registry first (docs/CLAUDE_SITEMAP_AI_CRAWLER_RULE.md §3, §4): only ever fetch URLs an
    // admin's rules (or explicit override) actually selected, not a blind sample of the whole
    // sitemap. Falls back to the pre-registry live-sampling behavior below when the registry is
    // still empty for this source (never synced yet) — nothing breaks for a source mid-migration.
    const registryCandidates = await selectCandidatesFromRegistry(source.id, MAX_CANDIDATE_POOL);
    let toFetch: Candidate[];

    if (registryCandidates.length > 0) {
      stats.sourcesVisited = 1;
      toFetch = registryCandidates.map((c): Candidate => ({ url: c.url, registryRowId: c.id }));
    } else {
      const origin = new URL(source.baseUrl).origin;
      const sitemap = await loadCachedSitemap(origin, robotsInfo);
      if (!sitemap) {
        errors.push(`${source.domain}: could not find or parse a sitemap`);
        return { results: [], stats, errors };
      }
      stats.sourcesVisited = 1;

      const allEntries = sampleSitemapLocs(sitemap.xml, RAW_ENTRY_CAP, source.baseUrl);
      const sampled = selectGenericCandidates(allEntries, MAX_CANDIDATE_POOL);
      stats.pagesRejected = allEntries.length - sampled.length;
      toFetch = sampled.map((url): Candidate => ({ url }));
    }

    const allowAi = source.processingType !== "HTML";
    const results = await fetchCandidates(
      toFetch,
      criteria,
      source,
      allowAi,
      context,
      deadline,
      stats,
      errors,
    );
    // Candidates queued but never reached because the deadline hit — on top of the ones the
    // sampling step itself already excluded above. Matches `pagesRejected`'s meaning in
    // `providers/brilions/provider.ts`: it does not separately track "fetched but not a listing" —
    // that's simply the gap between `pagesVisited` and `offersExtracted`.
    stats.pagesRejected += toFetch.length - stats.pagesVisited;

    return { results, stats, errors };
  };
}

export function createGenericProvider(source: SearchSource): ExternalSearchProvider {
  return { id: `generic:${source.domain}`, search: buildRunSearch(source) };
}
