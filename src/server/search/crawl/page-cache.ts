import "server-only";
import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * DB-backed `PageCache` (spec §25). Written with the service-role client, matching
 * `search_runs`/`search_page_cache`'s RLS: cached third-party HTML is not user data, no client
 * role has any business touching it, so only server-side crawl code writes here.
 */

export interface CachedPage {
  url: string;
  html: string;
  httpStatus: number;
  fetchedAt: string;
  /** True when this row was already this fresh before the current crawl touched it. */
  fromCache: boolean;
}

export function hashContent(html: string): string {
  return createHash("sha256").update(html).digest("hex");
}

/** Returns the cached page if present and within `maxAgeMs`, else `null` — a miss, not an error. */
export async function getCachedPage(url: string, maxAgeMs: number): Promise<CachedPage | null> {
  const { data, error } = await createAdminClient()
    .from("search_page_cache")
    .select("url, html, http_status, fetched_at")
    .eq("url", url)
    .maybeSingle();

  if (error || !data) return null;
  if (Date.now() - new Date(data.fetched_at).getTime() > maxAgeMs) return null;

  return { url: data.url, html: data.html, httpStatus: data.http_status, fetchedAt: data.fetched_at, fromCache: true };
}

/**
 * Upserts a freshly fetched page. `content_hash` is stored (not just recomputed on read) so a
 * future extraction-cache layer can key off "did this page's content actually change" without
 * re-hashing the HTML on every read.
 */
export async function putCachedPage(url: string, html: string, httpStatus: number): Promise<void> {
  await createAdminClient()
    .from("search_page_cache")
    .upsert(
      { url, html, http_status: httpStatus, content_hash: hashContent(html), fetched_at: new Date().toISOString() },
      { onConflict: "url" },
    );
}
