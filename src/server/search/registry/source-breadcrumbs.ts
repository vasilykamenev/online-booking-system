import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeForMatch } from "@/lib/search/text";
import type { BreadcrumbEntry } from "@/lib/search/structured-data";
import type { SearchCriteria } from "@/lib/search/request";

/**
 * A per-source, self-learning map of breadcrumb labels the generic provider (`providers/generic/provider.ts`)
 * has actually seen while crawling — built opportunistically from ordinary search traffic, no separate
 * crawl job, no site-specific code. Answers one question: "for this source, do we already know a URL
 * for this place?" — a country directly (`{"Croatia": "https://sailica.com/catalog/croatia"}`), or a
 * city resolved to its own parent's URL (a city's own catalog page isn't what's returned; its parent's
 * is — see `resolveSeedUrl`'s doc comment for why).
 *
 * The reason this exists: the generic provider has no site-specific knowledge of how a source's own
 * filters/search work (`docs/search-source-processing-strategies.md`), so a location-qualified query
 * otherwise has to sample blindly from a source's *entire* catalog (`MAX_CANDIDATE_POOL` out of
 * however many pages a source has — 20 out of sailica.com's ~11,700). A breadcrumb trail a site
 * publishes on its own pages already states its own navigational URL for a place, without us guessing
 * anything about that site's URL scheme — this table just remembers what we've already been told.
 *
 * Never invents: `resolveSeedUrl` returns `null` whenever the map doesn't have a single, unambiguous
 * answer, rather than picking one — a stale/wrong seed would actively narrow a search to the wrong
 * pages, which is worse than the current unseeded (already-imperfect) sampling.
 */

/** Sentinel for "no parent" (a trail's first crumb) — kept as `""`, never `null`, so the DB's unique
 *  constraint (a plain column list) can dedupe/upsert on it; Postgres never treats two `NULL`s as
 *  equal, which would otherwise insert a fresh duplicate row for it on every crawl. */
const NO_PARENT = "";

interface StoredBreadcrumbRow {
  normalized_label: string;
  url: string;
  normalized_parent_label: string;
}

/**
 * Upserts every consecutive (label, parent) pair from one page's breadcrumb trail. Best-effort by
 * convention (caller `.catch()`s, same as `recordExtraction`/`recordFetchOutcome`) — this is an
 * optimization, never something a search can fail over.
 */
export async function recordBreadcrumbTrail(sourceId: string, trail: BreadcrumbEntry[]): Promise<void> {
  const now = new Date().toISOString();
  const byKey = new Map<
    string,
    { source_id: string; normalized_label: string; label: string; url: string; normalized_parent_label: string; last_seen_at: string }
  >();

  for (let i = 0; i < trail.length; i++) {
    const entry = trail[i];
    if (!entry.url) continue; // Nothing worth seeding without a URL to seed with.
    const parentName = i > 0 ? trail[i - 1].name : null;
    const row = {
      source_id: sourceId,
      normalized_label: normalizeForMatch(entry.name),
      label: entry.name,
      url: entry.url,
      normalized_parent_label: parentName ? normalizeForMatch(parentName) : NO_PARENT,
      last_seen_at: now,
    };
    // De-duplicated by conflict key before the upsert: Postgres rejects a single upsert batch that
    // affects the same conflict target twice, and a page's own trail could in principle repeat one
    // (e.g. a malformed BreadcrumbList).
    byKey.set(`${row.normalized_label}::${row.normalized_parent_label}`, row);
  }

  const rows = [...byKey.values()];
  if (rows.length === 0) return;

  await createAdminClient()
    .from("search_source_breadcrumbs")
    .upsert(rows, { onConflict: "source_id,normalized_label,normalized_parent_label" });
}

async function findRowsForLabel(sourceId: string, label: string): Promise<StoredBreadcrumbRow[]> {
  const { data } = await createAdminClient()
    .from("search_source_breadcrumbs")
    .select("normalized_label, url, normalized_parent_label")
    .eq("source_id", sourceId)
    .eq("normalized_label", normalizeForMatch(label));
  return data ?? [];
}

/**
 * Pure "never guess" core, split out from the DB read above so it's directly unit-testable: the URL
 * every row agrees on, or `null` when there are no rows *or* they disagree (more than one distinct
 * URL stored for the same label — an ambiguity, not a tiebreak).
 */
export function pickUnambiguousUrl(rows: { url: string }[]): string | null {
  if (rows.length === 0) return null;
  const distinctUrls = new Set(rows.map((row) => row.url));
  return distinctUrls.size === 1 ? rows[0].url : null;
}

/**
 * Pure "never guess" core for the city→parent step: the one parent label every row agrees on, or
 * `null` when there are no rows, none have a real parent, or they disagree (the same city label
 * stored under more than one distinct parent — exactly the real-world collision this whole mechanism
 * exists to decline rather than resolve wrong).
 */
export function pickUnambiguousParent(rows: { normalizedParentLabel: string }[]): string | null {
  const distinctParents = new Set(
    rows.map((row) => row.normalizedParentLabel).filter((parent) => parent !== NO_PARENT),
  );
  return distinctParents.size === 1 ? [...distinctParents][0] : null;
}

/** The URL stored for `label` on this source, or `null` when there's no stored entry *or* the stored
 *  entries disagree on the URL (ambiguous — never guess which is right). */
async function resolveLabelUrl(sourceId: string, label: string): Promise<string | null> {
  const rows = await findRowsForLabel(sourceId, label);
  return pickUnambiguousUrl(rows);
}

export interface SeedUrlResult {
  url: string;
  /** Which label the URL was resolved from — the country itself, or a city's resolved parent.
   *  Diagnostic only (`detailed_logging`), not used for anything behavioral. */
  matchedLabel: string;
}

/**
 * The single entry point `providers/generic/provider.ts` calls. Country wins when the query states
 * one (`{"country": "Turkey"}` looked up directly); otherwise, a city is resolved *through* its
 * parent — not the city's own stored URL — because the same city name can recur under different
 * parents across a source's real catalog (Split, Georgia vs. Split, Croatia), while a parent-per-city
 * mismatch is exactly the signal this function uses to refuse to guess: if every stored row for that
 * city agrees on one parent, that parent's own URL is trustworthy; if they disagree, `null`.
 */
export async function resolveSeedUrl(
  sourceId: string,
  criteria: SearchCriteria,
): Promise<SeedUrlResult | null> {
  const country = criteria.location?.country ?? null;
  if (country) {
    const url = await resolveLabelUrl(sourceId, country);
    if (url) return { url, matchedLabel: country };
  }

  const city = criteria.location?.city ?? null;
  if (city) {
    const rows = await findRowsForLabel(sourceId, city);
    const parentLabel = pickUnambiguousParent(
      rows.map((row) => ({ normalizedParentLabel: row.normalized_parent_label })),
    );
    if (parentLabel) {
      const url = await resolveLabelUrl(sourceId, parentLabel);
      if (url) return { url, matchedLabel: parentLabel };
    }
  }

  return null;
}
