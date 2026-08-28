import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SearchCriteria } from "@/lib/search/criteria";
import type { VesselSearchResult } from "@/lib/search/result";
import { matchesKnownCriteria } from "@/lib/search/match-criteria";
import { extractBreadcrumbTrail, extractJsonLdFields, matchBreadcrumbLocation } from "@/lib/search/structured-data";
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
import { recordExtraction, resultToListingFields, touchExtraction } from "@/server/search/registry/extracted-listings";
import { getFreshListing, getStaleListing, listingRowToResult } from "@/server/search/registry/listing-index";
import type { FieldSource } from "@/server/search/registry/listing-merge";
import { recordBreadcrumbTrail, resolveSeedUrl } from "@/server/search/registry/source-breadcrumbs";
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
// How fresh a `search_extracted_listings` row must be to serve a candidate without any network
// activity at all (design doc §4 P3). Deliberately equal to `PAGE_CACHE_MS` — the index and the
// raw-HTML cache expiring in lockstep keeps there being only one freshness knob to reason about.
// Once this elapses, `fetchCandidate` no longer skips the network entirely, but it isn't a full
// unconditional re-fetch either: design doc §5.4's ETag/If-Modified-Since check (`fetchWithCache`'s
// conditional-revalidation path) tries first, and a `304` still avoids the expensive part
// (re-running selectors/JSON-LD/AI) even though a request did go out.
const INDEX_FRESHNESS_MS = PAGE_CACHE_MS;
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
 * Gated by `search_sources.detailed_logging` (admin-set per source, `/admin/search-sources`'s form —
 * see `source-registry.ts`'s `SearchSource.detailedLogging` doc comment), because this is meaningfully
 * more log volume than the rest of the pipeline produces: every step of every candidate on every
 * search against that source, not just aggregate stats. Meant for actively answering "why does this
 * source return zero/wrong results" (read via Vercel runtime logs — filter on the domain-tagged
 * prefix this emits), not as a standing setting every source carries. `console.log` rather than the
 * `errors[]` array `runSearch` already returns: `errors` is a *user-facing-adjacent* diagnostic
 * surfaced through `search_runs`/the discover page's degraded banner, sized for "what went wrong",
 * while this is a developer-facing trace sized for "what happened, step by step" — mixing the two
 * would spam `search_runs` with routine, expected detail on every search from a logging-enabled
 * source, not just failures.
 */
function logDetail(source: SearchSource, message: string, detail?: Record<string, unknown>): void {
  if (!source.detailedLogging) return;
  if (detail) console.log(`[generic:${source.domain}] ${message}`, detail);
  else console.log(`[generic:${source.domain}] ${message}`);
}

/** `null` for a malformed URL — a stored seed should never be malformed, but this is one bad row away
 *  from a crashed search otherwise. */
function safePathname(url: string): string | null {
  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
}

/** Whether `url`'s own path falls under `prefixPath` — malformed candidate URLs never match rather
 *  than throwing (a candidate list already came from our own sitemap parsing, but this runs on
 *  arbitrary third-party strings, not worth trusting blindly). */
function matchesUrlPrefix(url: string, prefixPath: string): boolean {
  const pathname = safePathname(url);
  return pathname !== null && pathname.startsWith(prefixPath);
}

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
  /** True when this candidate was served from `search_extracted_listings` (design doc §4 P3) rather
   *  than a live fetch — `fieldSource`/`confidence` are always `null` in that case, since nothing new
   *  was learned this request. Callers must skip both `recordFetchOutcome` (no fetch happened) and
   *  `recordExtraction` (would be a no-op) when this is true. */
  fromIndex: boolean;
  /** True when a conditional GET confirmed the page hasn't changed since the last successful
   *  extraction (design doc §5.4) — `result` here is the *previous* extraction, reused rather than
   *  re-derived, so (like `fromIndex`) `recordExtraction` would be a no-op. Unlike `fromIndex`, a
   *  real network round-trip did happen: `recordFetchOutcome` should still run, and this counts
   *  toward its own stat (`pagesRevalidatedUnchanged`), not `pagesServedFromIndex`. */
  revalidatedUnchanged: boolean;
}

/** The live-fetch path — never sets `fromIndex`/`revalidatedUnchanged` itself, so its return type
 *  omits them and the one caller below (`fetchCandidate`) fills them in as `false`, keeping every
 *  return statement here unchanged from before P3. */
async function fetchAndNormalize(
  url: string,
  source: SearchSource,
  criteria: SearchCriteria,
  allowAi: boolean,
): Promise<Omit<FetchedCandidate, "fromIndex" | "revalidatedUnchanged">> {
  const page = await fetchWithCache(url, PAGE_CACHE_MS);
  if (!page.ok || !page.html) {
    return { result: null, usedAi: false, pageOk: false, contentHash: null, note: null, fieldSource: null, confidence: null };
  }
  const contentHash = hashContent(page.html);

  const retrievedAt = new Date().toISOString();

  // Recorded unconditionally, independent of which tier (or none) ends up handling this page as a
  // listing: a category/hub page (sailica.com's /catalog/turkey) is exactly the page
  // `registry/source-breadcrumbs.ts` most wants to learn from, and such pages are deliberately
  // excluded from `extractJsonLdFields`'s listing detection (`NON_LISTING_TYPES`) — so their
  // breadcrumb would never be seen at all if this only ran inside the JSON-LD listing branch below.
  // Best-effort, additive — never read back by this same request, so a write failure here must never
  // affect the response.
  const breadcrumbTrail = extractBreadcrumbTrail(page.html);
  if (breadcrumbTrail.length > 0) {
    recordBreadcrumbTrail(source.id, breadcrumbTrail).catch(() => {});
  }

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
    // Most sites' per-listing JSON-LD has no address of its own (observed live on sailica.com —
    // see `JsonLdFields.breadcrumbLabels`'s doc comment) — without this, `country`/`city` would
    // always be null here, and `matchesKnownCriteria` then hard-filters every result out the moment
    // a query names a place, zeroing out the source's results for exactly the queries it should
    // answer. Confirms rather than guesses: only the wanted country/city the query actually asked
    // for, and only when the page's own breadcrumb trail literally states it.
    const confirmedLocation = matchBreadcrumbLocation(structured.breadcrumbLabels, {
      country: criteria.location?.country ?? null,
      city: criteria.location?.city ?? null,
    });
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
        country: confirmedLocation.country,
        city: confirmedLocation.city,
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

/**
 * Whether a cache-served `result` is worth a cheap location re-check against *this* query: the query
 * actually asked for a place, and the cached row came back with no location at all.
 *
 * Deliberately keyed off the *result's* location being empty, not off the stored row's field
 * provenance (an earlier version checked `field_provenance.country?.source === "JSON_LD"` — but the
 * JSON-LD tier stopped persisting `country`/`city` under that source entirely once it stopped
 * persisting query-scoped confirmations at all (`fetchCandidates`'s own persistence comment), so a
 * freshly-cached row from that tier now has *no* provenance entry for the field to match against —
 * the exact condition this was meant to catch could never fire again, silently turning the recheck
 * into dead code for every extraction going forward, only ever helping legacy rows written before
 * that fix shipped. A row with no location, regardless of *why* it has none, is exactly the case
 * worth a free second look: `reconfirmCachedLocation` is a no-op if the cached HTML has no usable
 * breadcrumb, so this is never worse than skipping the check, only sometimes better.
 */
function locationNeedsRecheck(result: VesselSearchResult, criteria: SearchCriteria): boolean {
  if (!criteria.location?.country && !criteria.location?.city) return false;
  return result.location.country === null && result.location.city === null;
}

/**
 * Re-confirms a cache-served candidate's location against *this* query from already-fetched HTML —
 * no extra network round-trip beyond what the caller already did (a fresh page-cache read, or the
 * conditional-GET revalidation it was already performing), and never AI, just the same free
 * breadcrumb match `fetchAndNormalize`'s JSON-LD tier itself uses. Ephemeral like that confirmation
 * too: the caller must never persist this back to `search_extracted_listings` (see this file's own
 * persistence comment in `fetchCandidates` for why).
 */
function reconfirmCachedLocation(
  result: VesselSearchResult,
  criteria: SearchCriteria,
  html: string,
): VesselSearchResult {
  const structured = extractJsonLdFields(html);
  if (!structured) return result;

  const confirmed = matchBreadcrumbLocation(structured.breadcrumbLabels, {
    country: criteria.location?.country ?? null,
    city: criteria.location?.city ?? null,
  });
  return { ...result, location: { ...result.location, country: confirmed.country, city: confirmed.city } };
}

/**
 * Checks `search_extracted_listings` before falling back to a live fetch (design doc §4 P3), then
 * — if that missed — tries one cheaper thing before a full re-extraction (design doc §5.4): a
 * conditional GET against whatever validator (`etag`/`last-modified`) the last fetch of this page
 * stored. A `304` means the origin confirms nothing changed, so the stale row's already-extracted
 * values are still correct — reuse them and just extend their freshness, skipping selectors/JSON-LD/AI
 * entirely for this candidate. Any other outcome (no stale row, no validator stored, or the page
 * really did change) falls straight through to `fetchAndNormalize`, which then does a normal fetch —
 * cheap since `fetchWithCache` already populated the page cache while checking, so this never costs a
 * second network round-trip.
 */
async function fetchCandidate(
  url: string,
  source: SearchSource,
  criteria: SearchCriteria,
  allowAi: boolean,
): Promise<FetchedCandidate> {
  const cached = await getFreshListing(source.id, url, INDEX_FRESHNESS_MS);
  if (cached) {
    let result = listingRowToResult(cached, {
      type: "WEBSITE",
      name: source.name,
      domain: source.domain,
      url,
      retrievedAt: cached.last_extracted_at,
    });
    if (locationNeedsRecheck(result, criteria)) {
      const page = await fetchWithCache(url, PAGE_CACHE_MS);
      if (page.ok && page.html) result = reconfirmCachedLocation(result, criteria, page.html);
      logDetail(source, "cached result had no location — re-checked against this query", {
        url,
        confirmed: { country: result.location.country, city: result.location.city },
      });
    }
    return {
      result,
      usedAi: false,
      pageOk: true,
      contentHash: null,
      note: null,
      fieldSource: null,
      confidence: null,
      fromIndex: true,
      revalidatedUnchanged: false,
    };
  }

  const stale = await getStaleListing(source.id, url);
  if (stale) {
    const revalidation = await fetchWithCache(url, INDEX_FRESHNESS_MS);
    if (revalidation.ok && revalidation.contentUnchanged) {
      const retrievedAt = new Date().toISOString();
      await touchExtraction(source.id, url, retrievedAt);
      let result = listingRowToResult(stale, {
        type: "WEBSITE",
        name: source.name,
        domain: source.domain,
        url,
        retrievedAt,
      });
      if (locationNeedsRecheck(result, criteria) && revalidation.html) {
        result = reconfirmCachedLocation(result, criteria, revalidation.html);
        logDetail(source, "revalidated-unchanged result had no location — re-checked against this query", {
          url,
          confirmed: { country: result.location.country, city: result.location.city },
        });
      }
      return {
        result,
        usedAi: false,
        pageOk: true,
        contentHash: null,
        note: null,
        fieldSource: null,
        confidence: null,
        fromIndex: false,
        revalidatedUnchanged: true,
      };
    }
  }

  const live = await fetchAndNormalize(url, source, criteria, allowAi);
  return { ...live, fromIndex: false, revalidatedUnchanged: false };
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
        const { result, usedAi, pageOk, contentHash, note, fieldSource, confidence, fromIndex, revalidatedUnchanged } =
          await fetchCandidate(url, source, criteria, allowAi);
        const matched = result !== null && matchesKnownCriteria(result, criteria);
        logDetail(source, "candidate fetched", {
          url,
          outcome: fromIndex
            ? "served-from-index"
            : revalidatedUnchanged
              ? "revalidated-unchanged"
              : pageOk
                ? "live-fetch"
                : "fetch-failed",
          fieldSource,
          hasResult: result !== null,
          location: result ? { country: result.location.country, city: result.location.city } : null,
          matched,
          rejectedReason:
            result && !matched
              ? (criteria.location?.country || criteria.location?.city) &&
                !result.location.country &&
                !result.location.city
                ? "no confirmed location for this query"
                : criteria.vesselTypes.length > 0 && result.vesselType && !criteria.vesselTypes.includes(result.vesselType)
                  ? "vessel type mismatch"
                  : criteria.capacity?.persons && result.capacity.guests !== null && result.capacity.guests < criteria.capacity.persons
                    ? "capacity too small"
                    : "unknown"
              : null,
        });
        if (fromIndex) {
          stats.pagesServedFromIndex += 1;
        } else if (revalidatedUnchanged) {
          stats.pagesRevalidatedUnchanged += 1;
        } else {
          stats.pagesVisited += 1;
          if (usedAi) stats.aiCalls += 1;
        }
        if (note) errors.push(note);
        if (result) {
          stats.offersExtracted += 1;
          if (matched) results.push(result);
          if (!fromIndex && !revalidatedUnchanged && fieldSource && confidence !== null) {
            const persistedFields = resultToListingFields(result);
            // The JSON-LD tier's location is confirmed only against *this request's own* criteria
            // (`matchBreadcrumbLocation`'s doc comment: "яхта в Турции" confirms "Turkey" because
            // *that query* asked about Turkey and the page's breadcrumb happens to say so — it is
            // not a claim that this page's country is Turkey in general). `search_extracted_listings`
            // is query-independent and reused by every future search regardless of what it asks for
            // (`getFreshListing` is age-gated only, not criteria-aware), and a stored field's `null`
            // never overwrites an existing value (`listing-merge.ts`: "no opinion", never "clear").
            // Persisting this confirmation would therefore permanently mislabel the page with
            // whichever place the *first* query that ever indexed it happened to ask about — observed
            // live: a Turkey-query confirmation on a sailica.com candidate then got served, unchanged,
            // as that page's location to a later, unrelated Estonia query, passing
            // `matchesKnownCriteria`'s presence check on a value that was simply wrong for it. Every
            // other JSON-LD field here (name/price/description) *is* a stable, query-independent fact
            // and keeps persisting as before — only location is query-scoped for this tier.
            if (fieldSource === "JSON_LD") {
              delete persistedFields.country;
              delete persistedFields.city;
            }
            // Best-effort, additive persistence (design doc data-merger-provenance-design.md phase P1) —
            // never read back by this same request, so a failure here must never affect the response.
            recordExtraction({
              sourceId: source.id,
              url,
              fields: persistedFields,
              fieldSource,
              confidence,
              sourceUrl: url,
              retrievedAt: result.source.retrievedAt,
              image: result.images[0]?.url ?? null,
            }).catch(() => {});
          }
        }
        if (registryRowId && !fromIndex) {
          // Best-effort — closes the loop `crawl_status: PENDING → FETCHED/FAILED` (spec §3) for
          // real search traffic without a dedicated background fetch job. Never lets a write
          // failure surface as a search failure. Skipped only when served from the index (no fetch
          // happened this request) — a revalidated-unchanged candidate still ran a real conditional
          // GET, so its crawl outcome is recorded like any other fetch.
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

    logDetail(source, "search started", {
      query: {
        country: criteria.location?.country ?? null,
        region: criteria.location?.region ?? null,
        city: criteria.location?.city ?? null,
        vesselTypes: criteria.vesselTypes,
        persons: criteria.capacity?.persons ?? null,
      },
      timeoutMs: context.timeoutMs,
    });

    const robotsInfo = await fetchRobotsInfo(source.baseUrl);
    const allowed = await resolveRobotsAllowed(source, robotsInfo);
    logDetail(source, "robots.txt check", { found: robotsInfo.found, allowed });
    if (!allowed) {
      errors.push(`${source.domain}: robots.txt disallows / — skipping`);
      logDetail(source, "search stopped — robots.txt disallows /");
      return { results: [], stats, errors };
    }

    // Self-learning location seed (design discussion: `registry/source-breadcrumbs.ts`) — a URL this
    // source has already shown us for the query's own country (or a city resolved to its single,
    // unambiguous parent), if any. `null` on a cold start (never seen this place on this source yet):
    // everything below then behaves exactly as it did before this existed.
    const seed = await resolveSeedUrl(source.id, criteria);
    const seedPrefix = seed ? safePathname(seed.url) : null;
    logDetail(source, "location seed lookup", { seed, seedPrefix });

    // URL Registry first (docs/CLAUDE_SITEMAP_AI_CRAWLER_RULE.md §3, §4): only ever fetch URLs an
    // admin's rules (or explicit override) actually selected, not a blind sample of the whole
    // sitemap. Falls back to the pre-registry live-sampling behavior below when the registry is
    // still empty for this source (never synced yet) — nothing breaks for a source mid-migration.
    const registryCandidates = await selectCandidatesFromRegistry(
      source.id,
      MAX_CANDIDATE_POOL,
      seedPrefix ?? undefined,
    );
    let toFetch: Candidate[];

    if (registryCandidates.length > 0) {
      stats.sourcesVisited = 1;
      toFetch = registryCandidates.map((c): Candidate => ({ url: c.url, registryRowId: c.id }));
      logDetail(source, "candidates selected from URL registry", {
        count: toFetch.length,
        seeded: seedPrefix !== null,
        urls: toFetch.map((c) => c.url),
      });
    } else {
      const origin = new URL(source.baseUrl).origin;
      const sitemap = await loadCachedSitemap(origin, robotsInfo);
      if (!sitemap) {
        errors.push(`${source.domain}: could not find or parse a sitemap`);
        logDetail(source, "search stopped — URL registry empty and no sitemap found");
        return { results: [], stats, errors };
      }
      stats.sourcesVisited = 1;

      const allEntries = sampleSitemapLocs(sitemap.xml, RAW_ENTRY_CAP, source.baseUrl);
      // Same "prefer the seeded prefix, top up from the rest" shape as the registry branch above —
      // deliberately not just reordering `allEntries` before `selectGenericCandidates`'s even-stride
      // sample: a small prefix-matching subset would barely change which *indices* an even stride
      // lands on across the whole (still mostly-unrelated) array, so this samples the two groups
      // separately instead.
      const seededEntries = seedPrefix ? allEntries.filter((entryUrl) => matchesUrlPrefix(entryUrl, seedPrefix)) : [];
      const seededSample = seededEntries.slice(0, MAX_CANDIDATE_POOL);
      const remainingEntries = seedPrefix
        ? allEntries.filter((entryUrl) => !matchesUrlPrefix(entryUrl, seedPrefix))
        : allEntries;
      const topUpSample = selectGenericCandidates(remainingEntries, MAX_CANDIDATE_POOL - seededSample.length);
      const sampled = [...seededSample, ...topUpSample];
      stats.pagesRejected = allEntries.length - sampled.length;
      toFetch = sampled.map((url): Candidate => ({ url }));
      logDetail(source, "URL registry empty — fell back to a live sitemap sample", {
        sitemapUrl: sitemap.url,
        totalEntries: allEntries.length,
        seededMatches: seededEntries.length,
        sampledCount: sampled.length,
        urls: toFetch.map((c) => c.url),
      });
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
    // that's simply the gap between `pagesVisited` and `offersExtracted`. `pagesServedFromIndex` and
    // `pagesRevalidatedUnchanged` candidates were also reached, just not through a full live fetch,
    // so neither must count as rejected.
    stats.pagesRejected +=
      toFetch.length - stats.pagesVisited - stats.pagesServedFromIndex - stats.pagesRevalidatedUnchanged;

    logDetail(source, "search finished", { resultCount: results.length, stats, errors });

    return { results, stats, errors };
  };
}

export function createGenericProvider(source: SearchSource): ExternalSearchProvider {
  return { id: `generic:${source.domain}`, search: buildRunSearch(source) };
}
