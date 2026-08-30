import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";
import { fetchRobotsInfo, type RobotsInfo } from "@/server/search/crawl/robots";
import { discoverAllSitemapEntries } from "@/server/search/crawl/full-sitemap-discovery";
import { discoverUrlsByCrawling } from "@/server/search/crawl/html-link-discovery";
import {
  classifyUrl,
  DEFAULT_CRAWL_RULES,
  type CrawlRule,
  type UrlClassification,
} from "@/server/search/registry/url-classification";

/**
 * Orchestrates the URL Registry (docs/CLAUDE_SITEMAP_AI_CRAWLER_RULE.md §3, §4, §8) — the DB-facing
 * layer on top of the pure logic in `url-classification.ts` and the network layer in
 * `crawl/full-sitemap-discovery.ts` (sitemap walk) and `crawl/html-link-discovery.ts` (same-origin
 * link crawl, used when a source has no sitemap at all — see `discoverEntries`). Deliberately thin
 * and untested at the unit level, same as `source-registry.ts` (no `.test.ts` of its own) —
 * everything worth unit-testing here already is, in those modules.
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

/** PostgREST's `max_rows` (`supabase/config.toml`) caps any single `.select()` at 1000 rows with no
 *  error or truncation signal — `.data` just silently comes back short. `listAllSelectedUrls` below
 *  already pages through with `.range()` for exactly this reason; every other read here that needs
 *  a source's *complete* `search_source_urls` set (not a sample) must too, once a source's registry
 *  grows past 1000 rows (sailica.com: ~3,000+) — found live when a newly added crawl rule only
 *  reclassified the first ~1000 of ~3,000 stored URLs, silently leaving the rest on their stale
 *  classification. */
const SOURCE_URLS_PAGE_SIZE = 1000;

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
 *  survive a rules/auto-select change, not just the initial sync). Also `reclassifyStoredUrls`'s only
 *  source of "every URL currently on file" — its own `url` keys double as that list, so there's no
 *  separate select to keep paginated in sync with this one. */
async function loadExistingOverrides(
  supabase: SupabaseServerClient,
  sourceId: string,
): Promise<Map<string, boolean | null>> {
  const overrides = new Map<string, boolean | null>();

  for (let offset = 0; ; offset += SOURCE_URLS_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("search_source_urls")
      .select("url, selection_override")
      .eq("source_id", sourceId)
      .order("id", { ascending: true })
      .range(offset, offset + SOURCE_URLS_PAGE_SIZE - 1);
    if (error || !data) break;
    for (const row of data) overrides.set(row.url, row.selection_override);
    if (data.length < SOURCE_URLS_PAGE_SIZE) break;
  }

  return overrides;
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
  /** Rows removed because their URL's origin no longer matches the source's own `base_url` — see
   *  `pruneForeignUrls`. Surfaced so an admin can see contamination actually got cleaned up. */
  pruned: number;
  /** Which discovery path actually produced `discovered` — `null` only when the sync failed before
   *  either could run. Surfaced so an admin can tell "this site has no sitemap, so we crawled links
   *  instead" from "this site has a sitemap and it's just small". */
  method: "sitemap" | "html-crawl" | null;
}

export interface SourceDiscoveryEntry {
  loc: string;
  lastmod: string | null;
  /** Which sitemap document listed this URL — `null` for an `html-crawl` entry, which has no
   *  sitemap to attribute to. */
  sourceSitemap: string | null;
}

interface SourceDiscoveryResult {
  entries: SourceDiscoveryEntry[];
  truncated: boolean;
  method: "sitemap" | "html-crawl";
}

/**
 * The shared discovery step behind both `discoverSourceUrls` (a real sync) and
 * `previewSourceCrawlClassification` (the read-only preview) — kept as one function so the two never
 * drift into showing an admin different things for "what would a sync find". Sitemap discovery
 * (spec §2.3, §5.2) is always tried first; a same-origin link crawl
 * (`crawl/html-link-discovery.ts`) only runs when the sitemap walk comes back with nothing — a site
 * that publishes a sitemap, even a mostly-empty one, is trusted over a guess made by following links.
 */
async function discoverEntries(baseUrl: string, robotsInfo: RobotsInfo): Promise<SourceDiscoveryResult> {
  const origin = new URL(baseUrl).origin;
  const sitemapResult = await discoverAllSitemapEntries(origin, robotsInfo.sitemapUrls);
  if (sitemapResult.entries.length > 0) {
    return {
      entries: sitemapResult.entries.map((entry) => ({
        loc: entry.loc,
        lastmod: entry.lastmod,
        sourceSitemap: entry.sourceSitemap,
      })),
      truncated: sitemapResult.truncated,
      method: "sitemap",
    };
  }

  const crawlResult = await discoverUrlsByCrawling(baseUrl, robotsInfo.rules);
  return {
    entries: crawlResult.entries.map((entry) => ({ loc: entry.loc, lastmod: null, sourceSitemap: null })),
    truncated: crawlResult.truncated,
    method: "html-crawl",
  };
}

/**
 * Deletes registry rows whose URL doesn't belong to this source's own origin. The one case a sync
 * must actively clean up rather than leave alone: `discoverSourceUrls` always walks `source.baseUrl`
 * itself, so every URL it returns is same-origin by construction — a stored row that isn't is not a
 * page that "went missing from the sitemap" (the case `last_seen_at`'s doc comment carves out), it's
 * contamination from some earlier moment when `base_url` pointed somewhere else (e.g. a source
 * created from another one by mistake, then corrected). Runs on every full sync, so re-pointing a
 * source at the right URL and clicking "Resync now" self-heals it — no manual DB cleanup needed.
 */
async function pruneForeignUrls(
  supabase: SupabaseServerClient,
  sourceId: string,
  origin: string,
): Promise<number> {
  const foreignIds: string[] = [];

  for (let offset = 0; ; offset += SOURCE_URLS_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("search_source_urls")
      .select("id, url")
      .eq("source_id", sourceId)
      .order("id", { ascending: true })
      .range(offset, offset + SOURCE_URLS_PAGE_SIZE - 1);
    if (error || !data) break;
    foreignIds.push(...data.filter((row) => !row.url.startsWith(origin)).map((row) => row.id));
    if (data.length < SOURCE_URLS_PAGE_SIZE) break;
  }
  if (foreignIds.length === 0) return 0;

  // Deleting can't use the same page size as the read above — `.in()` with 1000+ UUIDs risks the
  // exact "URI too long" failure this codebase has already hit elsewhere (`admin.ts`'s
  // `getOpenFieldConflicts`) — so this chunks the delete itself, independent of the read loop above.
  for (let i = 0; i < foreignIds.length; i += UPSERT_CHUNK_SIZE) {
    await supabase.from("search_source_urls").delete().in("id", foreignIds.slice(i, i + UPSERT_CHUNK_SIZE));
  }
  return foreignIds.length;
}

/** Network-only step: robots.txt → full recursive sitemap walk. No DB access, so it can be tested
 *  or retried independently of the classify/upsert step. */
export async function discoverSourceUrls(baseUrl: string): Promise<SourceDiscoveryResult> {
  const robotsInfo = await fetchRobotsInfo(baseUrl);
  return discoverEntries(baseUrl, robotsInfo);
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
    const pruned = await pruneForeignUrls(supabase, source.id, new URL(source.baseUrl).origin);
    return { discovered: rows.length, truncated: discovery.truncated, pruned, method: discovery.method };
  } catch {
    return { discovered: 0, truncated: false, pruned: 0, method: null };
  }
}

/**
 * Re-runs classification against already-discovered URLs (no network) — used after a crawl rule or
 * `auto_select_classifications` changes, so the effect is visible immediately without waiting for
 * (or forcing) a full re-crawl. Preserves manual overrides the same way `syncSourceUrlRegistry` does.
 */
export async function reclassifyStoredUrls(supabase: SupabaseServerClient, sourceId: string): Promise<number> {
  // `loadExistingOverrides` already pages through the *complete* set (see its own doc comment) —
  // its keys are every URL on file for this source, which is exactly what used to come from this
  // function's own separate, unpaginated select (silently capped at PostgREST's 1000-row default).
  const [overrides, rules, autoSelect] = await Promise.all([
    loadExistingOverrides(supabase, sourceId),
    loadCrawlRules(supabase, sourceId),
    loadAutoSelect(supabase, sourceId),
  ]);

  const rows = [...overrides.entries()].map(([url, override]): ClassifiedRow => {
    const { classification, priority } = classifyUrl(pathOf(url), rules);
    return {
      source_id: sourceId,
      url,
      classification,
      priority,
      selected: override ?? autoSelect.includes(classification),
    };
  });

  await upsertClassifiedRows(supabase, rows);
  return rows.length;
}

export interface AddManualUrlsResult {
  added: number;
  /** URLs rejected for being malformed or, more commonly, for belonging to a different domain than
   *  this source's own `base_url` — never silently added and then swept away by the next sync's
   *  `pruneForeignUrls`, rejected up front instead. */
  skipped: number;
}

/**
 * The manual-entry escape hatch for a source with no sitemap and nothing (or nothing useful) for
 * `discoverUrlsByCrawling` to find by following links — an admin who already knows the exact detail
 * page URLs can paste them in directly. Classified with the source's current rules exactly like a
 * real sync's discoveries, so they show up correctly bucketed in the registry and get fetched by
 * live search on the same terms as anything a sitemap or crawl would have found. Survives future
 * syncs the same way any registry row does — a sync only adds/reclassifies, never deletes a row
 * merely for not being rediscovered (see `search_source_urls`'s migration comment).
 */
export async function addManualUrls(
  supabase: SupabaseServerClient,
  source: SourceSyncTarget,
  rawUrls: string[],
): Promise<AddManualUrlsResult> {
  const origin = new URL(source.baseUrl).origin;

  const valid = new Set<string>();
  let skipped = 0;
  for (const raw of rawUrls) {
    try {
      const parsed = new URL(raw.trim());
      parsed.hash = "";
      if (parsed.origin !== origin) {
        skipped++;
        continue;
      }
      valid.add(parsed.toString());
    } catch {
      skipped++;
    }
  }
  if (valid.size === 0) return { added: 0, skipped };

  const [rules, autoSelect, overrides] = await Promise.all([
    loadCrawlRules(supabase, source.id),
    loadAutoSelect(supabase, source.id),
    loadExistingOverrides(supabase, source.id),
  ]);

  const now = new Date().toISOString();
  const rows: ClassifiedRow[] = [...valid].map((url) => {
    const { classification, priority } = classifyUrl(pathOf(url), rules);
    const override = overrides.get(url) ?? null;
    return {
      source_id: source.id,
      url,
      classification,
      priority,
      selected: override ?? autoSelect.includes(classification),
      last_seen_at: now,
    };
  });

  await upsertClassifiedRows(supabase, rows);
  return { added: rows.length, skipped };
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
    /** True only when the discovery walk itself hit a resource limit (depth/sitemap-count/URL-count
     *  for a sitemap walk, or pages-visited/depth/URL-count for a link crawl) — not a display
     *  concern, since `entries` is never further truncated. */
    truncated: boolean;
    /** Which discovery path produced `entries` — see `discoverEntries`'s doc comment. Lets the UI
     *  tell an admin "no sitemap, these came from following links on the homepage" instead of
     *  silently presenting a link-crawl result as if it were a sitemap read. */
    method: "sitemap" | "html-crawl";
  };
}

/**
 * Live, read-only preview for the crawl-rules admin page: fetches robots.txt and runs the same
 * discovery `syncSourceUrlRegistry` would (`discoverEntries` — sitemap walk, falling back to a
 * same-origin link crawl when the site has no sitemap), then classifies every discovered URL with
 * the source's *currently saved* rules — but writes nothing to `search_source_urls`. Lets an admin
 * see "what would this rule set actually do to the real site" without paying for (or waiting on) a
 * full persisted sync. Unlike `syncSourceUrlRegistry`, this does NOT catch network errors — the
 * caller (a Server Action) is expected to, since a preview failure should surface to the admin as
 * "couldn't check the site", not silently show empty results.
 */
export async function previewSourceCrawlClassification(
  supabase: SupabaseServerClient,
  source: SourceSyncTarget,
): Promise<CrawlPreviewResult> {
  const [robotsInfo, rules] = await Promise.all([
    fetchRobotsInfo(source.baseUrl),
    loadCrawlRules(supabase, source.id),
  ]);

  const discovery = await discoverEntries(source.baseUrl, robotsInfo);

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
      method: discovery.method,
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
/**
 * `urlPrefix` (design discussion: self-learning per-source location map, `registry/source-breadcrumbs.ts`)
 * biases the pool toward a place the current query named and this source has already shown us a URL
 * for — e.g. sailica.com's own `/catalog/estonia` — without narrowing to *just* that: a first pass
 * fetches up to `limit` prefix-matching rows, and only if that falls short does a second pass top up
 * with the normal (unfiltered) ordering, excluding what the first pass already picked. A location the
 * registry happens to have no candidates under must never *reduce* the total fetched below what an
 * unseeded search would have gotten.
 */
export async function selectCandidatesFromRegistry(
  sourceId: string,
  limit: number,
  urlPrefix?: string,
): Promise<RegistryCandidate[]> {
  const supabase = await createClient();

  function baseQuery() {
    return supabase
      .from("search_source_urls")
      .select("id, url")
      .eq("source_id", sourceId)
      .eq("selected", true)
      // Postgres orders an enum column by its declaration position, not alphabetically — the
      // migration declares `search_url_classification` as ('HIGH', 'MEDIUM', 'LOW', 'SKIP'), so
      // ascending here really does mean "most worth fetching first".
      .order("classification", { ascending: true })
      .order("priority", { ascending: false })
      .order("last_seen_at", { ascending: false });
  }

  if (!urlPrefix) {
    const { data, error } = await baseQuery().limit(limit);
    return error ? [] : (data ?? []);
  }

  const { data: seeded, error: seededError } = await baseQuery()
    .ilike("url", `${urlPrefix}%`)
    .limit(limit);
  if (seededError) return [];
  if (seeded.length >= limit) return seeded;

  // No `.not("id", "in", "()")` when `seeded` is empty: an empty Postgres `IN (...)` list makes every
  // row's membership test NULL rather than false, which `NOT` then leaves NULL too — silently
  // excluding every row from the top-up query instead of none of them.
  let topUpQuery = baseQuery().limit(limit - seeded.length);
  if (seeded.length > 0) {
    topUpQuery = topUpQuery.not("id", "in", `(${seeded.map((row) => `"${row.id}"`).join(",")})`);
  }
  const { data: rest, error: restError } = await topUpQuery;
  if (restError) return seeded;

  return [...seeded, ...(rest ?? [])];
}

/**
 * Every `selected` URL for a source, unpaginated by the caller — Э5's indexer walks the whole
 * registry, not a query-budgeted sample the way `selectCandidatesFromRegistry` does for live search.
 * Paginates internally past PostgREST's default row cap so a registry larger than one page's worth
 * still gets indexed in full, per Э5's own "Готово когда" ("наполняется полностью, а не выборкой").
 * Runs with the service-role client — the indexer is a cron/admin-triggered job, not live request
 * traffic, so there's no caller session to read with instead.
 */
export async function listAllSelectedUrls(sourceId: string): Promise<RegistryCandidate[]> {
  const supabase = createAdminClient();
  const pageSize = 1000;
  const all: RegistryCandidate[] = [];

  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from("search_source_urls")
      .select("id, url")
      .eq("source_id", sourceId)
      .eq("selected", true)
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error || !data) break;
    all.push(...data);
    if (data.length < pageSize) break;
  }

  return all;
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
