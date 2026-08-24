import { z } from "zod";
import type { Database } from "@/lib/supabase/database.types";

export const userRoleValues = [
  "client",
  "owner",
  "admin",
] as const satisfies readonly Database["public"]["Enums"]["user_role"][];

export const updateUserRoleSchema = z.object({
  userId: z.guid(),
  role: z.enum(userRoleValues),
});
export type UpdateUserRoleInput = z.infer<typeof updateUserRoleSchema>;

export const locationSchema = z.object({
  countryRu: z.string().trim().min(1).max(200),
  countryEn: z.string().trim().min(1).max(200),
  cityRu: z.string().trim().min(1).max(200),
  cityEn: z.string().trim().min(1).max(200),
  marinaRu: z.string().trim().max(200).default(""),
  marinaEn: z.string().trim().max(200).default(""),
  // Required: every location needs a point so vessels/initiatives that don't
  // set their own pin can still fall back to the marina's default location
  // on the map (see supabase/migrations/20260817120001_geo_coordinates.sql).
  latitude: z.preprocess(
    (value) => (typeof value === "string" && value.trim() !== "" ? Number(value) : value),
    z.number().min(-90).max(90),
  ),
  longitude: z.preprocess(
    (value) => (typeof value === "string" && value.trim() !== "" ? Number(value) : value),
    z.number().min(-180).max(180),
  ),
});
export type LocationInput = z.infer<typeof locationSchema>;

export const amenityKeySchema = z.object({
  key: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/, "invalidKey"),
});
export type AmenityKeyInput = z.infer<typeof amenityKeySchema>;

// Entered as a whole percentage (e.g. "12" for 12%), stored as a 0-1 fraction.
export const commissionRateSchema = z.object({
  ratePercent: z.coerce.number().min(0).max(100),
});
export type CommissionRateInput = z.infer<typeof commissionRateSchema>;

export const searchSourceTypeValues = [
  "WEBSITE",
  "API",
] as const satisfies readonly Database["public"]["Enums"]["search_source_type"][];

export const searchProcessingTypeValues = [
  "API",
  "HTML",
  "STRUCTURED_DATA",
  "AI_EXTRACTION",
  "HYBRID",
] as const satisfies readonly Database["public"]["Enums"]["search_processing_type"][];

export const urlClassificationValues = [
  "HIGH",
  "MEDIUM",
  "LOW",
  "SKIP",
] as const satisfies readonly Database["public"]["Enums"]["search_url_classification"][];

export const crawlRulePatternTypeValues = [
  "PREFIX",
  "REGEX",
] as const satisfies readonly Database["public"]["Enums"]["search_crawl_rule_pattern_type"][];

/**
 * A row here is registry metadata (reliability bonus for ranking, cached robots.txt verdict) —
 * it does not by itself make the app crawl the site. Actually searching a source still requires
 * an `ExternalSearchProvider` implementation wired into `discover/page.tsx`'s `externalProviders`
 * array (see `src/server/search/README.md`). The admin form makes this explicit rather than
 * implying "add a row, get a new source searched".
 */
const DOMAIN_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

export const searchSourceSchema = z.object({
  name: z.string().trim().min(1).max(120),
  domain: z.string().trim().toLowerCase().regex(DOMAIN_PATTERN, "invalidDomain"),
  baseUrl: z.url().max(500),
  sourceType: z.enum(searchSourceTypeValues),
  processingType: z.enum(searchProcessingTypeValues),
  priority: z.coerce.number().int().min(0).max(1000).default(50),
  notes: z.string().trim().max(2000).default(""),
  // Raw JSON text from the form's textarea — parsed and validated against `selectorConfigSchema`
  // separately (`parseSelectorConfig`), not here, so a bad-JSON error can get its own translated
  // message instead of tripping the generic "invalid" error for the whole form.
  selectorConfig: z.string().trim().max(5000).default(""),
  // Raw newline/comma-separated text from the form — parsed and validated separately
  // (`parseImageDomains`), same reasoning as `selectorConfig` above.
  imageDomains: z.string().trim().max(1000).default(""),
  // Checkbox group (`formData.getAll(...)`) — which URL Registry classifications
  // (docs/CLAUDE_SITEMAP_AI_CRAWLER_RULE.md §4) get auto-selected for fetching without a per-URL
  // manual override (`search_source_urls.selection_override`). Empty is valid — "nothing
  // auto-selected, pick URLs by hand" is a legitimate (if unusual) choice, not an error.
  autoSelectClassifications: z.array(z.enum(urlClassificationValues)).default([]),
});
export type SearchSourceInput = z.infer<typeof searchSourceSchema>;

/**
 * A source's own crawl-rule row (docs/CLAUDE_SITEMAP_AI_CRAWLER_RULE.md §4) — deterministic
 * path-prefix classification, editable per source in `/admin/search-sources/[id]/urls`. Mirrors
 * `CrawlRule` (`src/server/search/registry/url-classification.ts`) field-for-field; kept as a
 * separate schema rather than importing that interface because this one validates raw form input
 * (`priority` arrives as a string) while that one is the pure-logic shape.
 */
export const crawlRuleSchema = z
  .object({
    pattern: z.string().trim().min(1).max(300),
    // "PREFIX" (literal path prefix, optional trailing "*") or "REGEX" (ECMAScript regex source,
    // no delimiters/flags, tested against the URL's pathname) — see `CrawlRule` in
    // `src/server/search/registry/url-classification.ts`.
    patternType: z.enum(crawlRulePatternTypeValues).default("PREFIX"),
    classification: z.enum(urlClassificationValues),
    priority: z.coerce.number().int().min(-1000).max(1000).default(0),
  })
  .superRefine((value, ctx) => {
    if (value.patternType !== "REGEX") return;
    try {
      new RegExp(value.pattern);
    } catch {
      ctx.addIssue({ code: "custom", path: ["pattern"], message: "invalidRegex" });
    }
  });
export type CrawlRuleInput = z.infer<typeof crawlRuleSchema>;

/**
 * CSS-selector-based field extraction for a `search_sources` row's `HTML`/`HYBRID` `processingType`
 * (docs/search-source-processing-strategies.md §1.1) — what makes `providers/generic/provider.ts`'s
 * `extractBySelectors()` able to attempt those two strategies for a source with no purpose-built
 * `ExternalSearchProvider`, the same way it already attempts `AI_EXTRACTION`/`STRUCTURED_DATA` for
 * any source. Field names mirror `GenericExtractedFields`
 * (`src/server/search/providers/generic/normalize.ts`) exactly — this config only ever says where to
 * find those same fields, never introduces new ones.
 */
const selectorFieldSchema = z.object({
  selector: z.string().trim().min(1).max(300),
  /** Attribute to read (`content` for `<meta>`, `src`/`data-src` for `<img>`, ...); omitted means
   *  the element's own text content. */
  attr: z.string().trim().min(1).max(100).optional(),
  /** Optional capture-group-1 regex applied to the selected text/attribute — e.g. pulling "8" out
   *  of "Гостей: 8" — never lets a malformed pattern blank the field (see `extractBySelectors`). */
  regex: z.string().trim().min(1).max(300).optional(),
});

export const selectorConfigSchema = z.object({
  fields: z.object({
    // `name` unresolved means the whole extraction is treated as a miss (see `extractBySelectors`),
    // same convention as the JSON-LD tier it sits alongside.
    name: selectorFieldSchema.optional(),
    description: selectorFieldSchema.optional(),
    image: selectorFieldSchema.optional(),
    guests: selectorFieldSchema.optional(),
    cabins: selectorFieldSchema.optional(),
    vesselTypeRaw: selectorFieldSchema.optional(),
    country: selectorFieldSchema.optional(),
    city: selectorFieldSchema.optional(),
  }),
});
export type SelectorConfig = z.infer<typeof selectorConfigSchema>;

export type ParsedSelectorConfig =
  | { ok: true; value: SelectorConfig | null }
  | { ok: false };

/** Empty input is a valid "no selectors configured" — everything else must be valid JSON matching
 *  `selectorConfigSchema`, or the whole thing is rejected rather than silently dropped. */
export function parseSelectorConfig(raw: string): ParsedSelectorConfig {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: null };

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { ok: false };
  }

  const result = selectorConfigSchema.safeParse(parsed);
  return result.success ? { ok: true, value: result.data } : { ok: false };
}

export type ParsedImageDomains = { ok: true; value: string[] } | { ok: false };

/**
 * Trusted image-CDN hostnames for a source, beyond its own `domain` — `api/external-image/route.ts`'s
 * proxy allows either. Split on commas/whitespace/newlines so admins can paste a list in whatever
 * shape is convenient; each entry must itself be a valid domain (same `DOMAIN_PATTERN` as the
 * source's own `domain` field — a proxy allowlist entry is exactly as security-sensitive as that
 * field is). Empty input is valid — "no extra image hosts", not an error.
 */
export function parseImageDomains(raw: string): ParsedImageDomains {
  const entries = raw
    .split(/[\s,]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);

  if (entries.some((entry) => !DOMAIN_PATTERN.test(entry))) return { ok: false };
  return { ok: true, value: [...new Set(entries)] };
}
