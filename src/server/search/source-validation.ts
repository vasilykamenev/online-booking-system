import "server-only";
import { safeFetch } from "@/server/search/crawl/safe-fetch";
import { isAllowedByRobots } from "@/server/search/crawl/robots-rules";
import { fetchRobotsInfo } from "@/server/search/crawl/robots";
import { discoverSitemap } from "@/server/search/crawl/sitemap-discovery";
import { sampleSitemapLocs } from "@/server/search/crawl/sitemap-rules";
import { extractJsonLdFields, extractJsonLdTypes } from "@/lib/search/structured-data";
import { extractPageSummary } from "@/lib/search/page-text";
import {
  classifyCandidatePage,
  type CandidateClassification,
} from "@/server/search/candidate-classifier";
import { suggestSelectors } from "@/server/search/selector-suggestion";
import type { SearchProcessingType } from "@/server/search/source-registry";
import type { SelectorConfig } from "@/lib/validation/admin";

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
  /** The homepage's own `<title>` tag, trimmed and capped to `searchSourceSchema`'s `name` limit
   *  (120 chars) — a starting point for the form's Name field, same "suggest, never apply on its
   *  own" treatment as `suggestedProcessingType`/`suggestedSelectorConfig` below. `null` when the
   *  site wasn't reachable or published no `<title>`. */
  suggestedName: string | null;
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
  /** The first sample's `suggestedSelectors`, when any sample produced one — see
   *  `CandidatePreviewSample.suggestedSelectors`. */
  suggestedSelectorConfig: SelectorConfig | null;
  candidatePreview: CandidatePreview;
}

/**
 * Whether an image this candidate published lives on the source's own domain — the exact question
 * `api/external-image/route.ts`'s proxy allow-list needs answered before registration, not after: a
 * source whose photos are hosted on a separate CDN (globesailor.ru → static.theglobesailor.com,
 * sailica.com → sailica-media.fsn1.your-objectstorage.com — both found live, both cost every result
 * from the source a broken image until an admin noticed and added the host to `imageDomains`) looks
 * identical to a working source in every other part of this preview, so nothing else would have
 * caught it before the source went live.
 */
export interface CandidateImageCheck {
  url: string;
  domain: string;
  matchesSourceDomain: boolean;
}

/**
 * The actual payload a live search would extract from this page — the same tiers and fields
 * `providers/generic/provider.ts`'s `fetchAndNormalize` uses, run here read-only so an admin can see
 * *what* the source will hand over before committing to it, not just *whether* it looks like a
 * listing. `null` when the page wasn't recognized as a listing at all (see `classification`/
 * `structuredDataTypes` for why).
 */
export interface CandidateExtractedFields {
  name: string | null;
  description: string | null;
  price: number | null;
  currency: string | null;
  guests: number | null;
  cabins: number | null;
  vesselTypeRaw: string | null;
  country: string | null;
  city: string | null;
  /** Raw `BreadcrumbList` trail, when the page's JSON-LD published one — shown as-is, not mapped to
   *  country/city here: breadcrumb position has no standard meaning across sites (see
   *  `matchBreadcrumbLocation`'s doc comment in `lib/search/structured-data.ts`), so this is what an
   *  admin reviews to judge for themselves whether a crawl rule or a live query could reasonably
   *  confirm a location from it. */
  breadcrumbLabels: string[];
  image: CandidateImageCheck | null;
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
  /** CSS selectors an AI call proposed for this page's fields (docs/search-source-processing-strategies.md
   *  §1.1) — only attempted once `classification` already recognized the page as a vessel listing,
   *  since there's nothing worth pointing selectors at otherwise. Null when not attempted or the
   *  model produced nothing usable; always a suggestion for the admin to review, never applied on
   *  its own. */
  suggestedSelectors: SelectorConfig | null;
  /** Null when the page couldn't be fetched or wasn't recognized as a listing by either tier. */
  extractedFields: CandidateExtractedFields | null;
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

/** `null` for a relative/malformed image URL — same "absent beats invented" treatment as every
 *  other field here, not a thrown error. */
function buildImageCheck(imageUrl: string | null, sourceDomain: string): CandidateImageCheck | null {
  if (!imageUrl) return null;
  try {
    const domain = new URL(imageUrl).hostname.replace(/^www\./, "");
    return { url: imageUrl, domain, matchesSourceDomain: domain === sourceDomain };
  } catch {
    return null;
  }
}

/**
 * Fetches, classifies, and — when the page reads as a listing — fully extracts one candidate detail
 * page, mirroring `providers/generic/provider.ts`'s own JSON-LD-before-AI tiers so this preview
 * shows exactly what a live search would get from the page, not just whether it looks promising.
 *
 * Structured data is trusted only once it actually names something (`extractJsonLdFields(...)?.name`,
 * not merely `extractJsonLdTypes(...).length > 0` — a page-wide `BreadcrumbList`/`Organization` block
 * with no listing node used to short-circuit straight past AI classification here, reporting a false
 * "structured match" for a page that in fact had nothing usable); only then does it fall back to the
 * AI classifier, same JSON-LD-before-AI priority as spec §11.
 */
async function previewCandidateSample(url: string, sourceDomain: string): Promise<CandidatePreviewSample> {
  const result = await safeFetch(url, PROBE_TIMEOUTS);
  if (!result.ok) {
    return {
      url,
      fetched: false,
      structuredDataTypes: [],
      classification: null,
      suggestedSelectors: null,
      extractedFields: null,
    };
  }

  const structuredDataTypes = extractJsonLdTypes(result.body);
  const structured = extractJsonLdFields(result.body);
  if (structured?.name) {
    return {
      url,
      fetched: true,
      structuredDataTypes,
      classification: null,
      suggestedSelectors: null,
      extractedFields: {
        name: structured.name,
        description: structured.description,
        price: structured.price,
        currency: structured.currency,
        // Not stated by this tier's own JSON-LD node — same gap `providers/generic/provider.ts`'s
        // JSON-LD tier has, not a bug specific to this preview.
        guests: null,
        cabins: null,
        vesselTypeRaw: null,
        country: null,
        city: null,
        breadcrumbLabels: structured.breadcrumbLabels,
        image: buildImageCheck(structured.image, sourceDomain),
      },
    };
  }

  const classification = await classifyCandidatePage(result.body);
  // Only worth proposing selectors once we already know this page is a vessel listing — nothing
  // to point them at otherwise, and it's an extra AI call, not a free one.
  const suggestedSelectors =
    classification.looksLikeVesselListing && classification.confidence >= 0.5
      ? await suggestSelectors(result.body)
      : null;

  const extractedFields = classification.looksLikeVesselListing
    ? {
        name: classification.extracted.name,
        description: extractPageSummary(result.body).description,
        // Never asked of this tier's model (same reasoning as the live provider's AI tier) —
        // JSON-LD is the only price source today.
        price: null,
        currency: null,
        guests: classification.extracted.guests,
        cabins: classification.extracted.cabins,
        vesselTypeRaw: classification.extracted.vesselTypeRaw,
        country: classification.extracted.country,
        city: classification.extracted.city,
        breadcrumbLabels: [],
        // `og:image`, read deterministically rather than asked of the model — same reasoning as the
        // live provider's AI tier: an AI-stated image URL risks being invented/malformed.
        image: buildImageCheck(extractPageSummary(result.body).image, sourceDomain),
      }
    : null;

  return { url, fetched: true, structuredDataTypes: [], classification, suggestedSelectors, extractedFields };
}

/**
 * Fetches and classifies a handful of candidate detail pages found in the sitemap (spec §9: "does
 * it contain vessel rental offers?").
 */
async function previewCandidates(sampleUrls: string[], sourceDomain: string): Promise<CandidatePreview> {
  if (sampleUrls.length === 0) return { attempted: false, samples: [] };

  const samples = await Promise.all(sampleUrls.map((url) => previewCandidateSample(url, sourceDomain)));
  return { attempted: true, samples };
}

/**
 * The single-URL counterpart to `previewCandidates` (spec §9): an admin who already knows which
 * page matters — a real listing found by browsing the site, not necessarily one of the sitemap's
 * first few entries — checks exactly that one page rather than waiting on a fresh random sample.
 * One page is enough to answer "what will this source actually hand over, including its photos".
 */
export async function previewCandidateAtUrl(
  baseUrl: string,
  candidateUrl: string,
): Promise<CandidatePreviewSample> {
  const sourceDomain = new URL(baseUrl).hostname.replace(/^www\./, "");
  return previewCandidateSample(candidateUrl, sourceDomain);
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
  // Capped to `searchSourceSchema.name`'s own 120-char max (`lib/validation/admin.ts`) so the
  // suggestion is always submittable as-is, not just close.
  const suggestedName = pageResult.ok ? (extractPageSummary(pageResult.body).title?.slice(0, 120) ?? null) : null;

  const sampleUrls = sitemap
    ? sampleSitemapLocs(sitemap.xml, MAX_CANDIDATE_SAMPLES, pageResult.ok ? pageResult.finalUrl : undefined)
    : [];
  const sourceDomain = parsedUrl.hostname.replace(/^www\./, "");
  const candidatePreview = await previewCandidates(sampleUrls, sourceDomain);

  return {
    reachable: pageResult.ok,
    status: pageResult.status ?? null,
    finalUrl: pageResult.ok ? pageResult.finalUrl : null,
    failureReason: pageResult.ok ? null : pageResult.reason,
    suggestedName,
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
    suggestedSelectorConfig:
      candidatePreview.samples.find((sample) => sample.suggestedSelectors)?.suggestedSelectors ?? null,
    candidatePreview,
  };
}
