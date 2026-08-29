import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import { selectorConfigSchema, type SelectorConfig } from "@/lib/validation/admin";
import type { SourceCoverageRow } from "@/server/search/coverage";

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
export type SearchAccessStrategy = Database["public"]["Enums"]["search_access_strategy"];
export type SearchContactCapability = Database["public"]["Enums"]["search_contact_capability"];

/** Арх §8's capability flags — what a source can be asked to do, independent of `reliabilityScore`
 *  (how well it currently does it). */
export interface SourceCapabilities {
  canSearch: boolean;
  canDetails: boolean;
  canAvailability: boolean;
  canPricing: boolean;
  canContact: boolean;
  supportsLocation: boolean;
  supportsDates: boolean;
  supportsPrice: boolean;
  supportsGuests: boolean;
}

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
  /** Null means the generic adapter still can't attempt `HTML`/`HYBRID` for this source — see
   *  `adapters/generic-adapter.ts`'s `supports()`. */
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
  /** Арх §8's access-strategy ladder — kept alongside `processingType` rather than replacing it;
   *  see the Э3 migration's own comment for why both exist until Э4 cuts provider selection over. */
  accessStrategy: SearchAccessStrategy;
  fallbackStrategies: SearchAccessStrategy[];
  capabilities: SourceCapabilities;
  contactCapability: SearchContactCapability | null;
  /** Арх §9 — asked by `coverage.ts`'s `sourceCovers` before a source is ever consulted. Empty means
   *  "not configured yet", which `sourceCovers` treats as "don't exclude", never "excludes everything". */
  coverage: SourceCoverageRow[];
}

const SOURCE_COLUMNS =
  "id, name, domain, base_url, enabled, source_type, processing_type, priority, reliability_score, robots_allows, last_checked_at, selector_config, image_domains, detailed_logging, access_strategy, fallback_strategies, can_search, can_details, can_availability, can_pricing, can_contact, supports_location, supports_dates, supports_price, supports_guests, contact_capability, search_source_coverage(worldwide, country, region, destination, latitude, longitude, radius_km)";

/** Shared row → `SearchSource` mapping between `listEnabledSources` and `getSourceById` — kept as
 *  one function so the two never drift into subtly different shapes for the same columns. */
function mapSourceRow(row: {
  id: string;
  name: string;
  domain: string;
  base_url: string;
  enabled: boolean;
  source_type: SearchSourceType;
  processing_type: SearchProcessingType;
  priority: number;
  reliability_score: number | null;
  robots_allows: boolean | null;
  last_checked_at: string | null;
  selector_config: unknown;
  image_domains: string[] | null;
  detailed_logging: boolean;
  access_strategy: SearchAccessStrategy;
  fallback_strategies: SearchAccessStrategy[] | null;
  can_search: boolean;
  can_details: boolean;
  can_availability: boolean;
  can_pricing: boolean;
  can_contact: boolean;
  supports_location: boolean;
  supports_dates: boolean;
  supports_price: boolean;
  supports_guests: boolean;
  contact_capability: SearchContactCapability | null;
  search_source_coverage:
    | {
        worldwide: boolean;
        country: string | null;
        region: string | null;
        destination: string | null;
        latitude: number | null;
        longitude: number | null;
        radius_km: number | null;
      }[]
    | null;
}): SearchSource {
  // A read failure must not break search: a malformed `selector_config` degrades this one source
  // back to "generic path unavailable" rather than failing the whole registry read.
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
    accessStrategy: row.access_strategy,
    fallbackStrategies: row.fallback_strategies ?? [],
    capabilities: {
      canSearch: row.can_search,
      canDetails: row.can_details,
      canAvailability: row.can_availability,
      canPricing: row.can_pricing,
      canContact: row.can_contact,
      supportsLocation: row.supports_location,
      supportsDates: row.supports_dates,
      supportsPrice: row.supports_price,
      supportsGuests: row.supports_guests,
    },
    contactCapability: row.contact_capability,
    coverage: (row.search_source_coverage ?? []).map((entry) => ({
      worldwide: entry.worldwide,
      country: entry.country,
      region: entry.region,
      destination: entry.destination,
      latitude: entry.latitude,
      longitude: entry.longitude,
      radiusKm: entry.radius_km,
    })),
  };
}

/** One source by id, regardless of `enabled`/`status` — the indexer (Э5) and admin manual
 *  re-index trigger both need to act on a specific registered source independent of whether it's
 *  currently live-searchable, unlike `listEnabledSources`'s search-time filter. `null` for a
 *  missing id or a read failure — same "absence over throwing" convention as this module's other
 *  reads. */
export async function getSourceById(id: string): Promise<SearchSource | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("search_sources").select(SOURCE_COLUMNS).eq("id", id).maybeSingle();
  if (error || !data) return null;
  return mapSourceRow(data);
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
    .select(SOURCE_COLUMNS)
    .eq("enabled", true)
    // Belt-and-suspenders: `enabled` should only ever be true alongside status = 'active' (that's
    // what `approveSearchSource` enforces), but a search-time read is exactly the place not to rely
    // on that invariant holding elsewhere — a draft/rejected row must never be searched, full stop.
    .eq("status", "active")
    .order("priority", { ascending: false });

  // A read failure must not break search — the internal half of a global search is perfectly
  // useful on its own, and an unreachable registry only costs us the external half. Logged (not
  // just swallowed) because this is otherwise invisible: `listExternalAdapters()`/
  // `listExternalAdaptersById()` read this as "zero enabled sources", which `candidate-phase.ts`
  // then reports as `candidatesFromIndex: 0` — indistinguishable, from the outside, from a registry
  // that's genuinely empty. A stuck migration or a broken RLS policy on `search_sources` would
  // otherwise degrade every search's external half to nothing with no trace in Vercel's error
  // monitoring at all.
  if (error) {
    console.error("[listEnabledSources] search_sources read failed", error);
    return [];
  }

  return (data ?? []).map(mapSourceRow);
});

/**
 * `processingType` → Арх §8's `access_strategy` — the same 1:1 mapping the Э3 migration backfilled
 * existing rows with, applied again on every create/update so the two columns never drift apart
 * while `adapters/generic-adapter.ts` still selects on `processingType` (see that migration's own comment
 * on why both columns coexist until Э4).
 */
export function accessStrategyFromProcessingType(processingType: SearchProcessingType): SearchAccessStrategy {
  switch (processingType) {
    case "API":
      return "API";
    case "STRUCTURED_DATA":
      return "STRUCTURED_DATA";
    case "AI_EXTRACTION":
      return "AI_EXTRACTION";
    case "HTML":
    case "HYBRID":
      return "WEB_PARSER";
  }
}

/** Domain → reliability, the shape `SearchRankingService` expects (spec §18). */
export async function getSourceReliability(): Promise<Record<string, number>> {
  const sources = await listEnabledSources();
  const map: Record<string, number> = {};
  for (const source of sources) {
    if (source.reliabilityScore !== null) map[source.domain] = source.reliabilityScore;
  }
  return map;
}
