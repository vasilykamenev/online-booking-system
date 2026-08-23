import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

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
      "id, name, domain, base_url, enabled, source_type, processing_type, priority, reliability_score, robots_allows, last_checked_at",
    )
    .eq("enabled", true)
    // Belt-and-suspenders: `enabled` should only ever be true alongside status = 'active' (that's
    // what `approveSearchSource` enforces), but a search-time read is exactly the place not to rely
    // on that invariant holding elsewhere — a draft/rejected row must never be searched, full stop.
    .eq("status", "active")
    .order("priority", { ascending: false });

  // A read failure must not break search — the internal half of a global search is perfectly
  // useful on its own, and an unreachable registry only costs us the external half.
  if (error) return [];

  return (data ?? []).map((row) => ({
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
  }));
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
