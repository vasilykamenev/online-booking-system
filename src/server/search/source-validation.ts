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
 * are a single per-domain cache keyed to whatever path a specific adapter cares
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
  /** Э10 (Арх §19's onboarding checklist): a bounded, read-only probe for a WordPress-style REST
   *  API at `/wp-json/` — the one convention common enough across charter/booking sites to be worth
   *  guessing at without an admin already pointing at a specific endpoint. `found: false` means "not
   *  detected", never "confirmed absent" — a genuinely custom API at another path needs an admin who
   *  already knows the site to notice it. */
  apiEndpoint: { found: boolean; url: string | null };
  /** Э10: a bounded probe for `/graphql`. Only ever positive on a 2xx response (a GraphiQL/Apollo
   *  Sandbox IDE page, or a server that allows introspection over GET) — see `probeGraphQlEndpoint`'s
   *  own comment for why a 4xx "must provide query" response, the more common shape, can't be read
   *  here at all. `found: false` is therefore inconclusive as often as it is a real "no". */
  graphqlEndpoint: { found: boolean; url: string | null };
  /** Э10: the homepage's own HTML, scanned for a `<form>` whose field names read as a vessel search
   *  (location/dates/guests keywords — see `detectSearchForm`). Informational for the admin, same as
   *  `breadcrumbLabels` elsewhere in this report — nothing in `search_processing_type` today has a
   *  distinct "search URL" strategy to suggest from it (Арх §8's SEARCH_URL rung exists only on the
   *  newer `access_strategy` column, not yet reachable from this form — see source-registry.ts's own
   *  note on why `processingType` still drives selection until Э4 cuts adapters over). */
  searchForm: { found: boolean; action: string | null; method: string | null; fieldNames: string[] };
  /** Null when the site wasn't even reachable — there's nothing to base a suggestion on. */
  suggestedProcessingType: SearchProcessingType | null;
  /** The first sample's `suggestedSelectors`, when any sample produced one — see
   *  `CandidatePreviewSample.suggestedSelectors`. */
  suggestedSelectorConfig: SelectorConfig | null;
  candidatePreview: CandidatePreview;
}

/**
 * Whether an image this candidate published lives on the source's own domain — the exact question
 * `api/external-image/[encoded]/route.ts`'s proxy allow-list needs answered before registration, not after: a
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

/** Field-name keywords a real vessel search form's inputs tend to use — English and Russian sites
 *  both seen live in this registry (globesailor.ru, sailica.com, brilions.com). Two or more distinct
 *  matches inside the same `<form>` is the bar for calling it a search form rather than, say, a
 *  newsletter signup that happens to have a `location` cookie field. */
const SEARCH_FORM_KEYWORDS = [
  "location",
  "destination",
  "port",
  "marina",
  "city",
  "country",
  "date",
  "checkin",
  "checkout",
  "guests",
  "adults",
  "passengers",
  "persons",
  "cabins",
  "yacht",
  "boat",
  "vessel",
  "charter",
  "search",
  "query",
];

/** `<input>`/`<select>`/`<textarea>` `name` attributes inside one already-isolated `<form>...</form>`
 *  body — deliberately not a full HTML parse (no DOM library in this codebase's crawl pipeline; every
 *  other extractor here — `structured-data.ts`, `candidate-classifier.ts` — is regex/AI-based too),
 *  just enough to read a form's shape. */
function extractFormFieldNames(formBody: string): string[] {
  const names = new Set<string>();
  const fieldRegex = /<(?:input|select|textarea)\b[^>]*\bname=["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = fieldRegex.exec(formBody))) {
    names.add(match[1]);
  }
  return [...names];
}

/**
 * Э10 (Арх §19's "анализ URL поисковой формы" / "анализ структуры HTML"): scans a fetched homepage
 * for the first `<form>` whose field names read as a vessel search, exported (not just used
 * internally) so its regex heuristics are unit-testable without a live fetch — same split as every
 * other pure/I-O pair in this module (`buildImageCheck` vs. `previewCandidateSample`, etc.).
 */
export function detectSearchForm(html: string): SourceValidationReport["searchForm"] {
  const formRegex = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;
  let match: RegExpExecArray | null;
  while ((match = formRegex.exec(html))) {
    const [, attrs, body] = match;
    const fieldNames = extractFormFieldNames(body);
    const matchingFields = fieldNames.filter((name) =>
      SEARCH_FORM_KEYWORDS.some((keyword) => name.toLowerCase().includes(keyword)),
    );
    if (matchingFields.length >= 2) {
      const actionMatch = /\baction=["']([^"']*)["']/i.exec(attrs);
      const methodMatch = /\bmethod=["']([^"']*)["']/i.exec(attrs);
      return {
        found: true,
        action: actionMatch ? actionMatch[1] : null,
        method: methodMatch ? methodMatch[1].toUpperCase() : "GET",
        fieldNames,
      };
    }
  }
  return { found: false, action: null, method: null, fieldNames: [] };
}

/** Э10: a WordPress-style REST API convention (`/wp-json/`) — common enough across charter/booking
 *  sites built on WP to be worth one bounded, read-only probe. A genuinely custom API at another
 *  path is out of reach for an automated guess; the admin's own `notes` field is where that goes. */
async function probeApiEndpoint(origin: string): Promise<SourceValidationReport["apiEndpoint"]> {
  const url = `${origin}/wp-json/`;
  const result = await safeFetch(url, PROBE_TIMEOUTS);
  if (!result.ok) return { found: false, url: null };
  const looksLikeWpJson = /"routes"\s*:|"namespaces"\s*:/.test(result.body);
  return looksLikeWpJson ? { found: true, url } : { found: false, url: null };
}

/**
 * Э10: a bounded probe for a GraphQL endpoint at `/graphql`. `safeFetch` only ever returns a body
 * for a 2xx response (spec §24's SSRF-safe fetch never reads a non-OK body at all), so this can only
 * ever catch a server that answers a bare GET with 200 — a GraphiQL/Apollo Sandbox/GraphQL Playground
 * IDE page, or a server permissive enough to answer introspection over GET. The far more common shape
 * (a 4xx "must provide query string" JSON error) is invisible to this probe; `found: false` here is
 * therefore "not detected this way", not "confirmed absent".
 */
async function probeGraphQlEndpoint(origin: string): Promise<SourceValidationReport["graphqlEndpoint"]> {
  const url = `${origin}/graphql`;
  const result = await safeFetch(url, PROBE_TIMEOUTS);
  if (!result.ok) return { found: false, url: null };
  const looksLikeGraphQlIde = /graphiql|apollo\s*sandbox|graphql\s*playground/i.test(result.body);
  return looksLikeGraphQlIde ? { found: true, url } : { found: false, url: null };
}

/**
 * Extraction-pipeline priority per spec §11 (API -> JSON-LD -> HTML -> AI), applied to what was
 * actually observed: an Э10 API/GraphQL probe outranks everything else (Арх §8's ladder puts a real
 * API above structured data); failing that, homepage JSON-LD is the strongest remaining signal;
 * failing that, per-page JSON-LD on the sampled candidates; failing that, whether the AI classifier
 * recognized most samples as real vessel listings (in which case AI_EXTRACTION needs no site-specific
 * code to start working, unlike HTML, which would still need selectors written for this site). HTML
 * is the fallback when there's simply nothing yet to judge by (no sitemap, so no samples).
 *
 * `search_processing_type` has no distinct GraphQL/SearchURL value yet (only `search_access_strategy`
 * does — see `searchForm`'s own doc comment on this report), so a GraphQL find buckets into `"API"`
 * too, the closest existing meaning ("this source has a machine-readable interface").
 */
function suggestProcessingType(
  reachable: boolean,
  apiFound: boolean,
  graphqlFound: boolean,
  homepageStructuredDataFound: boolean,
  preview: CandidatePreview,
): SearchProcessingType | null {
  if (!reachable) return null;
  if (apiFound || graphqlFound) return "API";
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

  const [pageResult, robotsInfo, apiEndpoint, graphqlEndpoint] = await Promise.all([
    safeFetch(baseUrl, PROBE_TIMEOUTS),
    fetchRobotsInfo(baseUrl, PROBE_TIMEOUTS),
    probeApiEndpoint(origin),
    probeGraphQlEndpoint(origin),
  ]);

  const sitemap = await discoverSitemap(origin, robotsInfo.sitemapUrls, PROBE_TIMEOUTS);
  const structuredTypes = pageResult.ok ? extractJsonLdTypes(pageResult.body) : [];
  const structuredDataFound = structuredTypes.length > 0;
  // Capped to `searchSourceSchema.name`'s own 120-char max (`lib/validation/admin.ts`) so the
  // suggestion is always submittable as-is, not just close.
  const suggestedName = pageResult.ok ? (extractPageSummary(pageResult.body).title?.slice(0, 120) ?? null) : null;
  const searchForm = pageResult.ok ? detectSearchForm(pageResult.body) : { found: false, action: null, method: null, fieldNames: [] };

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
    apiEndpoint,
    graphqlEndpoint,
    searchForm,
    suggestedProcessingType: suggestProcessingType(
      pageResult.ok,
      apiEndpoint.found,
      graphqlEndpoint.found,
      structuredDataFound,
      candidatePreview,
    ),
    suggestedSelectorConfig:
      candidatePreview.samples.find((sample) => sample.suggestedSelectors)?.suggestedSelectors ?? null,
    candidatePreview,
  };
}
