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
  etag: string | null;
  lastModified: string | null;
}

export function hashContent(html: string): string {
  return createHash("sha256").update(html).digest("hex");
}

/**
 * Returns whatever row is stored for `url`, regardless of age — freshness is `cached-fetch.ts`'s
 * call, not this module's; a dumb key-value read here keeps that policy in exactly one place.
 * `null` is a miss, not an error.
 */
export async function getCachedPage(url: string): Promise<CachedPage | null> {
  const { data, error } = await createAdminClient()
    .from("search_page_cache")
    .select("url, html, http_status, fetched_at, etag, last_modified")
    .eq("url", url)
    .maybeSingle();

  if (error || !data) return null;
  return {
    url: data.url,
    html: data.html,
    httpStatus: data.http_status,
    fetchedAt: data.fetched_at,
    etag: data.etag,
    lastModified: data.last_modified,
  };
}

/**
 * Upserts a freshly fetched page. `content_hash` is stored (not just recomputed on read) so a
 * future extraction-cache layer can key off "did this page's content actually change" without
 * re-hashing the HTML on every read. `etag`/`lastModified` are whatever the origin sent, `null` when
 * it sent neither — most sites behind a CMS or CDN send no validator at all (design doc §5.4), which
 * `cached-fetch.ts` treats as "nothing to revalidate against", not an error.
 */
export async function putCachedPage(
  url: string,
  html: string,
  httpStatus: number,
  etag: string | null = null,
  lastModified: string | null = null,
): Promise<void> {
  await createAdminClient()
    .from("search_page_cache")
    .upsert(
      {
        url,
        html,
        http_status: httpStatus,
        content_hash: hashContent(html),
        fetched_at: new Date().toISOString(),
        etag,
        last_modified: lastModified,
      },
      { onConflict: "url" },
    );
}

/** Bumps `fetched_at` only, after a `304 Not Modified` confirms the stored HTML is still current —
 *  extends this row's freshness window without touching `html`/`content_hash`/validators (they're
 *  still correct; nothing about them changed). */
export async function touchCachedPage(url: string): Promise<void> {
  await createAdminClient()
    .from("search_page_cache")
    .update({ fetched_at: new Date().toISOString() })
    .eq("url", url);
}
