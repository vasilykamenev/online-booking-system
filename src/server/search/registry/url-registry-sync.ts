import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";
import { fetchRobotsInfo } from "@/server/search/crawl/robots";
import { discoverAllSitemapEntries } from "@/server/search/crawl/full-sitemap-discovery";
import {
  classifyUrl,
  DEFAULT_CRAWL_RULES,
  type CrawlRule,
  type UrlClassification,
} from "@/server/search/registry/url-classification";

/**
 * Orchestrates the URL Registry (docs/CLAUDE_SITEMAP_AI_CRAWLER_RULE.md §3, §4, §8) — the DB-facing
 * layer on top of the pure logic in `url-classification.ts` and the network layer in
 * `crawl/full-sitemap-discovery.ts`. Deliberately thin and untested at the unit level, same as
 * `source-registry.ts` (no `.test.ts` of its own) — everything worth unit-testing here already is,
 * in those two modules.
 *
 * Every write in this module runs through the caller's own session client (`createClient()`),
 * because every caller today is an admin-authenticated Server Action — RLS's
 * `search_source_urls_admin_write`/`search_source_crawl_rules_admin_all` policies gate it, the same
 * way the rest of `src/server/actions/admin.ts` works. `recordFetchOutcome` is the one exception —
 * it runs from live (anonymous-allowed) search, not an admin action, so it uses the service-role
 * client, matching `providers/generic/provider.ts`'s existing `resolveRobotsAllowed`.
 */

type SupabaseServerClient = SupabaseClient<Database>;

const UPSERT_CHUNK_SIZE = 500;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

async function loadCrawlRules(supabase: SupabaseServerClient, sourceId: string): Promise<CrawlRule[]> {
  const { data } = await supabase
    .from("search_source_crawl_rules")
    .select("pattern, pattern_type, classification, priority, enabled")
    .eq("source_id", sourceId)
    .order("priority", { ascending: false });

  if (!data || data.length === 0) return DEFAULT_CRAWL_RULES;
  return data.map((row) => ({
    pattern: row.pattern,
    patternType: row.pattern_type,
    classification: row.classification,
    priority: row.priority,
    enabled: row.enabled,
  }));
}

async function loadAutoSelect(supabase: SupabaseServerClient, sourceId: string): Promise<UrlClassification[]> {
  const { data } = await supabase
    .from("search_sources")
    .select("auto_select_classifications")
    .eq("id", sourceId)
    .maybeSingle();

  return data?.auto_select_classifications ?? ["HIGH"];
}

/** Existing manual overrides for a source, keyed by URL — read once per sync/reclassify so a
 *  re-classification never clobbers an admin's explicit per-URL pin (spec: selection "by list" must
 *  survive a rules/auto-select change, not just the initial sync). */
async function loadExistingOverrides(
  supabase: SupabaseServerClient,
  sourceId: string,
): Promise<Map<string, boolean | null>> {
  const { data } = await supabase
    .from("search_source_urls")
    .select("url, selection_override")
    .eq("source_id", sourceId);

  return new Map((data ?? []).map((row) => [row.url, row.selection_override]));
}

interface ClassifiedRow {
  source_id: string;
  url: string;
  classification: UrlClassification;
  priority: number;
  selected: boolean;
  source_sitemap?: string | null;
  sitemap_lastmod?: string | null;
  last_seen_at?: string;
}

async function upsertClassifiedRows(supabase: SupabaseServerClient, rows: ClassifiedRow[]): Promise<void> {
  for (const batch of chunk(rows, UPSERT_CHUNK_SIZE)) {
    await supabase.from("search_source_urls").upsert(batch, { onConflict: "source_id,url" });
  }
}

export interface SourceSyncTarget {
  id: string;
  baseUrl: string;
}

export interface SyncSummary {
  discovered: number;
  truncated: boolean;
}

/** Network-only step: robots.txt → full recursive sitemap walk. No DB access, so it can be tested
 *  or retried independently of the classify/upsert step. */
export async function discoverSourceUrls(baseUrl: string) {
  const origin = new URL(baseUrl).origin;
  const robotsInfo = await fetchRobotsInfo(baseUrl);
  return discoverAllSitemapEntries(origin, robotsInfo.sitemapUrls);
}

/**
 * Full sync: discover (network) + classify + upsert (DB). Best-effort by design — a source
 * registration/edit must succeed even when the site is briefly unreachable or the sitemap is
 * malformed; the registry simply stays empty or stale until the next sync, and
 * `providers/generic/provider.ts` falls back to its pre-registry live-sampling behavior in that
 * case. Never throws.
 */
export async function syncSourceUrlRegistry(
  supabase: SupabaseServerClient,
  source: SourceSyncTarget,
): Promise<SyncSummary> {
  try {
    const [discovery, rules, autoSelect, overrides] = await Promise.all([
      discoverSourceUrls(source.baseUrl),
      loadCrawlRules(supabase, source.id),
      loadAutoSelect(supabase, source.id),
      loadExistingOverrides(supabase, source.id),
    ]);

    const now = new Date().toISOString();
    const rows: ClassifiedRow[] = discovery.entries.map((entry) => {
      const { classification, priority } = classifyUrl(pathOf(entry.loc), rules);
      const override = overrides.get(entry.loc) ?? null;
      return {
        source_id: source.id,
        url: entry.loc,
        source_sitemap: entry.sourceSitemap,
        sitemap_lastmod: entry.lastmod,
        classification,
        priority,
        selected: override ?? autoSelect.includes(classification),
        last_seen_at: now,
      };
    });

    await upsertClassifiedRows(supabase, rows);
    return { discovered: rows.length, truncated: discovery.truncated };
  } catch {
    return { discovered: 0, truncated: false };
  }
}

/**
 * Re-runs classification against already-discovered URLs (no network) — used after a crawl rule or
 * `auto_select_classifications` changes, so the effect is visible immediately without waiting for
 * (or forcing) a full re-crawl. Preserves manual overrides the same way `syncSourceUrlRegistry` does.
 */
export async function reclassifyStoredUrls(supabase: SupabaseServerClient, sourceId: string): Promise<number> {
  const [existing, rules, autoSelect] = await Promise.all([
    supabase.from("search_source_urls").select("url, selection_override").eq("source_id", sourceId),
    loadCrawlRules(supabase, sourceId),
    loadAutoSelect(supabase, sourceId),
  ]);

  const rows = (existing.data ?? []).map((row): ClassifiedRow => {
    const { classification, priority } = classifyUrl(pathOf(row.url), rules);
    return {
      source_id: sourceId,
      url: row.url,
      classification,
      priority,
      selected: row.selection_override ?? autoSelect.includes(classification),
    };
  });

  await upsertClassifiedRows(supabase, rows);
  return rows.length;
}

export interface PreviewedUrl {
  url: string;
  classification: UrlClassification;
  priority: number;
}

export interface CrawlPreviewResult {
  robots: {
    found: boolean;
    rules: { path: string; allow: boolean }[];
    sitemapUrls: string[];
  };
  urls: {
    /** Every classified URL from this run, up to `full-sitemap-discovery.ts`'s own
     *  `MAX_URLS_TOTAL` (spec §5.2) — not further capped for display. The admin UI paginates this
     *  client-side rather than the server dropping rows, so "show me all of it" actually means all
     *  of it, not the first N. */
    entries: PreviewedUrl[];
    /** True only when the sitemap walk itself hit a resource limit (depth/sitemap-count/URL-count,
     *  spec §5.2) — not a display concern, since `entries` is never further truncated. */
    truncated: boolean;
  };
}

/**
 * Live, read-only preview for the crawl-rules admin page: fetches robots.txt and does a full
 * recursive sitemap walk (same network path `syncSourceUrlRegistry` uses), then classifies every
 * discovered URL with the source's *currently saved* rules — but writes nothing to
 * `search_source_urls`. Lets an admin see "what would this rule set actually do to the real site"
 * without paying for (or waiting on) a full persisted sync. Unlike `syncSourceUrlRegistry`, this
 * does NOT catch network errors — the caller (a Server Action) is expected to, since a preview
 * failure should surface to the admin as "couldn't check the site", not silently show empty results.
 */
export async function previewSourceCrawlClassification(
  supabase: SupabaseServerClient,
  source: SourceSyncTarget,
): Promise<CrawlPreviewResult> {
  const [robotsInfo, rules] = await Promise.all([
    fetchRobotsInfo(source.baseUrl),
    loadCrawlRules(supabase, source.id),
  ]);

  const origin = new URL(source.baseUrl).origin;
  const discovery = await discoverAllSitemapEntries(origin, robotsInfo.sitemapUrls);

  const entries = discovery.entries.map((entry): PreviewedUrl => {
    const { classification, priority } = classifyUrl(pathOf(entry.loc), rules);
    return { url: entry.loc, classification, priority };
  });

  return {
    robots: {
      found: robotsInfo.found,
      rules: robotsInfo.rules.rules,
      sitemapUrls: robotsInfo.sitemapUrls,
    },
    urls: {
      entries,
      truncated: discovery.truncated,
    },
  };
}

export interface RegistryCandidate {
  id: string;
  url: string;
}

/**
 * `selected` URLs for a source, ready to fetch — read with the caller's own client (anonymous
 * search traffic included), same reasoning as `source-registry.ts`'s `listEnabledSources`: relies
 * on `search_source_urls_public_read`'s `selected or is_admin()` policy rather than service-role
 * privileges, since this is public website metadata, not a secret.
 */
export async function selectCandidatesFromRegistry(sourceId: string, limit: number): Promise<RegistryCandidate[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("search_source_urls")
    .select("id, url")
    .eq("source_id", sourceId)
    .eq("selected", true)
    // Postgres orders an enum column by its declaration position, not alphabetically — the migration
    // declares `search_url_classification` as ('HIGH', 'MEDIUM', 'LOW', 'SKIP'), so ascending here
    // really does mean "most worth fetching first".
    .order("classification", { ascending: true })
    .order("priority", { ascending: false })
    .order("last_seen_at", { ascending: false })
    .limit(limit);

  if (error) return [];
  return data ?? [];
}

export interface FetchOutcome {
  httpStatus: number | null;
  contentHash: string | null;
  crawlStatus: Database["public"]["Enums"]["search_url_crawl_status"];
  ranAi: boolean;
}

/**
 * Writes a live search's fetch outcome back onto the registry row it came from — closes the loop
 * `crawl_status: PENDING → FETCHED/FAILED` (spec §3) without needing a dedicated background fetch
 * job: real search traffic already fetches these pages, this just records what happened. Runs with
 * the service-role client because live search is not an admin-authenticated request, same pattern
 * as `provider.ts`'s `resolveRobotsAllowed`. Best-effort — a write failure here must never surface
 * as a search failure.
 */
export async function recordFetchOutcome(rowId: string, outcome: FetchOutcome): Promise<void> {
  await createAdminClient()
    .from("search_source_urls")
    .update({
      crawl_status: outcome.crawlStatus,
      http_status: outcome.httpStatus,
      content_hash: outcome.contentHash,
      last_fetched_at: new Date().toISOString(),
      last_ai_processed_at: outcome.ranAi ? new Date().toISOString() : undefined,
    })
    .eq("id", rowId);
}
