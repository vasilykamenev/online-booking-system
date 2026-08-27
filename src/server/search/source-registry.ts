import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import { selectorConfigSchema, type SelectorConfig } from "@/lib/validation/admin";

/**
 * `SourceRegistryService` (spec §8).
 *
 * The registry is what stops every search from re-researching the internet: known, already
 * validated sources are consulted first and fast, and discovery only ever appends to it. That
 * accumulation is the point — spec §28 — each search that finds a good new site makes the next
 * search cheaper, faster and more stable.
 */

/** Straight from the DB enums, so a new strategy is a migration the types then enforce. */
export type SearchProcessingType = Database["public"]["Enums"]["search_processing_type"];
export type SearchSourceType = Database["public"]["Enums"]["search_source_type"];
export type SearchSourceStatus = Database["public"]["Enums"]["search_source_status"];

export interface SearchSource {
  id: string;
  name: string;
  domain: string;
  baseUrl: string;
  enabled: boolean;
  sourceType: SearchSourceType;
  processingType: SearchProcessingType;
  priority: number;
  /** Null until enough extraction outcomes exist to measure it. */
  reliabilityScore: number | null;
  /** Null means "not checked yet", which the crawler must treat as "check first", not "allowed". */
  robotsAllows: boolean | null;
  lastCheckedAt: string | null;
  /** Null means the generic provider still can't attempt `HTML`/`HYBRID` for this source — see
   *  `provider-registry.ts`'s `isGenericEligible`. */
  selectorConfig: SelectorConfig | null;
  /** Trusted image-CDN hostnames beyond `domain` itself — `api/external-image/[encoded]/route.ts`'s proxy
   *  allowlist checks both. A source's own pages and its photos are often on different hosts (e.g.
   *  globesailor.ru's listings link to images on static.theglobesailor.com); without this, every
   *  photo from such a source gets rejected by the proxy even though `domain` itself is correct. */
  imageDomains: string[];
  /** Admin-set per source (`/admin/search-sources`'s form) — when true, `providers/generic/provider.ts`
   *  logs step-by-step diagnostic detail for this source's live search runs to stdout (read via
   *  Vercel runtime logs). Off by default: meant for actively debugging one misbehaving source, not
   *  standing observability every source carries all the time. */
  detailedLogging: boolean;
}

/**
 * Enabled sources, highest priority first. Read with the caller's own client — the registry lists
 * public websites and carries no secrets, so its RLS policy allows a public read of enabled rows
 * and this path needs no service-role privileges.
 */
export const listEnabledSources = cache(async (): Promise<SearchSource[]> => {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("search_sources")
    .select(
      "id, name, domain, base_url, enabled, source_type, processing_type, priority, reliability_score, robots_allows, last_checked_at, selector_config, image_domains, detailed_logging",
    )
    .eq("enabled", true)
    // Belt-and-suspenders: `enabled` should only ever be true alongside status = 'active' (that's
    // what `approveSearchSource` enforces), but a search-time read is exactly the place not to rely
    // on that invariant holding elsewhere — a draft/rejected row must never be searched, full stop.
    .eq("status", "active")
    .order("priority", { ascending: false });

  // A read failure must not break search — the internal half of a global search is perfectly
  // useful on its own, and an unreachable registry only costs us the external half. Logged (not
  // just swallowed) because this is otherwise invisible: `getActiveExternalProviders()` reads this
  // as "zero enabled sources" and `global-search-service.ts` reports `externalPhase: "SKIPPED"` —
  // indistinguishable, from the outside, from a registry that's genuinely empty. A stuck migration
  // or a broken RLS policy on `search_sources` would otherwise degrade every search's external half
  // to nothing with no trace in Vercel's error monitoring at all.
  if (error) {
    console.error("[listEnabledSources] search_sources read failed", error);
    return [];
  }

  return (data ?? []).map((row) => {
    // A read failure must not break search (same principle as the outer `if (error) return []`
    // above): a malformed `selector_config` degrades this one source back to "generic path
    // unavailable" rather than failing the whole registry read.
    const parsedSelectorConfig = selectorConfigSchema.safeParse(row.selector_config);
    return {
      id: row.id,
      name: row.name,
      domain: row.domain,
      baseUrl: row.base_url,
      enabled: row.enabled,
      sourceType: row.source_type,
      processingType: row.processing_type,
      priority: row.priority,
      reliabilityScore: row.reliability_score,
      robotsAllows: row.robots_allows,
      lastCheckedAt: row.last_checked_at,
      selectorConfig: parsedSelectorConfig.success ? parsedSelectorConfig.data : null,
      imageDomains: row.image_domains ?? [],
      detailedLogging: row.detailed_logging,
    };
  });
});

/** Domain → reliability, the shape `SearchRankingService` expects (spec §18). */
export async function getSourceReliability(): Promise<Record<string, number>> {
  const sources = await listEnabledSources();
  const map: Record<string, number> = {};
  for (const source of sources) {
    if (source.reliabilityScore !== null) map[source.domain] = source.reliabilityScore;
  }
  return map;
}
