import "server-only";
import { safeFetch } from "@/server/search/crawl/safe-fetch";
import { isAllowedByRobots } from "@/server/search/crawl/robots-rules";
import { fetchRobotsInfo } from "@/server/search/crawl/robots";
import { discoverSitemap } from "@/server/search/crawl/sitemap-discovery";
import { sampleSitemapLocs } from "@/server/search/crawl/sitemap-rules";
import { extractJsonLdTypes } from "@/lib/search/structured-data";
import {
  classifyCandidatePage,
  type CandidateClassification,
} from "@/server/search/candidate-classifier";
import type { SearchProcessingType } from "@/server/search/source-registry";

/**
 * Live, read-only pre-registration checks for a candidate search source (spec §9: "a source must
 * pass validation/classification before being added to the registry"). Runs a small, bounded
 * number of requests through the same SSRF-safe fetch the real crawler uses, and never writes to
 * the database — this is a preview the admin reviews in `/admin/search-sources` before saving.
 *
 * Deliberately does **not** touch `search_sources.robots_allows`/`last_checked_at`: those columns
 * are a single per-domain cache keyed to whatever path a specific `ExternalSearchProvider` cares
 * about (see `providers/brilions/provider.ts`'s `resolveRobotsAllowed`, checked against `/yacht/`,
 * not `/`). Writing a root-path check into that same cache here would let a real provider trust a
 * verdict for a path it never asked about. (`providers/generic/provider.ts` is the exception where
 * checking `/` genuinely is what the provider itself does — it caches its own check separately.)
 */

export interface SourceValidationReport {
  reachable: boolean;
  status: number | null;
  finalUrl: string | null;
  failureReason: string | null;
  robotsTxt: {
    found: boolean;
    /** Whether the wildcard user-agent block allows the base URL's own path — informational only,
     *  a real provider re-checks its own paths independently. */
    allowsBasePath: boolean;
    sitemapUrls: string[];
  };
  sitemap: {
    found: boolean;
    url: string | null;
    entryCount: number | null;
  };
  structuredData: {
    found: boolean;
    types: string[];
  };
  /** Null when the site wasn't even reachable — there's nothing to base a suggestion on. */
  suggestedProcessingType: SearchProcessingType | null;
  candidatePreview: CandidatePreview;
}

export interface CandidatePreviewSample {
  url: string;
  fetched: boolean;
  /** Non-empty when this specific page (not just the homepage) publishes JSON-LD — the more
   *  reliable signal, so `classification` is skipped when this already answers the question. */
  structuredDataTypes: string[];
  /** Null when structured data already answered "is this a vessel listing?", or the page couldn't
   *  be fetched, or there was nothing to classify. */
  classification: CandidateClassification | null;
}

export interface CandidatePreview {
  /** False when there was no sitemap to sample candidate pages from — not a failure, just nothing
   *  to preview yet. */
  attempted: boolean;
  samples: CandidatePreviewSample[];
}

/** A quick pre-registration probe, not a crawl — kept snappy for an admin waiting on a click. */
const PROBE_TIMEOUTS = { connectTimeoutMs: 4_000, readTimeoutMs: 6_000 };
/** Bounds how many candidate detail pages get sampled for the classification preview — this is a
 *  quick registration-time check, not a crawl of the catalog. */
const MAX_CANDIDATE_SAMPLES = 3;

/**
 * Fetches and classifies a handful of candidate detail pages found in the sitemap (spec §9: "does
 * it contain vessel rental offers?"). Structured data on the sample page itself is trusted over the
 * homepage's (a listing index can carry different markup than its detail pages), and only falls
 * back to the AI classifier when a page has none — same JSON-LD-before-AI priority as spec §11.
 */
async function previewCandidates(sampleUrls: string[]): Promise<CandidatePreview> {
  if (sampleUrls.length === 0) return { attempted: false, samples: [] };

  const samples = await Promise.all(
    sampleUrls.map(async (url): Promise<CandidatePreviewSample> => {
      const result = await safeFetch(url, PROBE_TIMEOUTS);
      if (!result.ok) return { url, fetched: false, structuredDataTypes: [], classification: null };

      const structuredDataTypes = extractJsonLdTypes(result.body);
      if (structuredDataTypes.length > 0) {
        return { url, fetched: true, structuredDataTypes, classification: null };
      }

      return {
        url,
        fetched: true,
        structuredDataTypes: [],
        classification: await classifyCandidatePage(result.body),
      };
    }),
  );

  return { attempted: true, samples };
}

/**
 * Extraction-pipeline priority per spec §11 (API -> JSON-LD -> HTML -> AI), applied to what was
 * actually observed: homepage JSON-LD is the strongest signal; failing that, per-page JSON-LD on
 * the sampled candidates; failing that, whether the AI classifier recognized most samples as real
 * vessel listings (in which case AI_EXTRACTION needs no site-specific code to start working, unlike
 * HTML, which would still need selectors written for this site). HTML is the fallback when there's
 * simply nothing yet to judge by (no sitemap, so no samples).
 */
function suggestProcessingType(
  reachable: boolean,
  homepageStructuredDataFound: boolean,
  preview: CandidatePreview,
): SearchProcessingType | null {
  if (!reachable) return null;
  if (homepageStructuredDataFound) return "STRUCTURED_DATA";
  if (preview.samples.length === 0) return "HTML";

  const withStructuredData = preview.samples.filter((s) => s.structuredDataTypes.length > 0).length;
  if (withStructuredData / preview.samples.length >= 0.5) return "STRUCTURED_DATA";

  const looksLikeVessel = preview.samples.filter(
    (s) => s.classification?.looksLikeVesselListing && s.classification.confidence >= 0.5,
  ).length;
  if (looksLikeVessel / preview.samples.length >= 0.5) return "AI_EXTRACTION";

  return "HTML";
}

export async function validateSearchSource(baseUrl: string): Promise<SourceValidationReport> {
  const parsedUrl = new URL(baseUrl);
  const origin = parsedUrl.origin;
  const pathname = parsedUrl.pathname || "/";

  const [pageResult, robotsInfo] = await Promise.all([
    safeFetch(baseUrl, PROBE_TIMEOUTS),
    fetchRobotsInfo(baseUrl, PROBE_TIMEOUTS),
  ]);

  const sitemap = await discoverSitemap(origin, robotsInfo.sitemapUrls, PROBE_TIMEOUTS);
  const structuredTypes = pageResult.ok ? extractJsonLdTypes(pageResult.body) : [];
  const structuredDataFound = structuredTypes.length > 0;

  const sampleUrls = sitemap
    ? sampleSitemapLocs(sitemap.xml, MAX_CANDIDATE_SAMPLES, pageResult.ok ? pageResult.finalUrl : undefined)
    : [];
  const candidatePreview = await previewCandidates(sampleUrls);

  return {
    reachable: pageResult.ok,
    status: pageResult.status ?? null,
    finalUrl: pageResult.ok ? pageResult.finalUrl : null,
    failureReason: pageResult.ok ? null : pageResult.reason,
    robotsTxt: {
      found: robotsInfo.found,
      allowsBasePath: isAllowedByRobots(robotsInfo.rules, pathname),
      sitemapUrls: robotsInfo.sitemapUrls,
    },
    sitemap: sitemap
      ? { found: true, url: sitemap.url, entryCount: sitemap.entryCount }
      : { found: false, url: null, entryCount: null },
    structuredData: { found: structuredDataFound, types: structuredTypes },
    suggestedProcessingType: suggestProcessingType(pageResult.ok, structuredDataFound, candidatePreview),
    candidatePreview,
  };
}
