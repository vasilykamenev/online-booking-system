import { NextResponse } from "next/server";
import { safeFetchBinary } from "@/server/search/crawl/safe-fetch";
import { listEnabledSources } from "@/server/search/source-registry";

/**
 * Proxies a vessel photo from an external search source (spec §14's provenance requirement means
 * these images render right alongside our own — `discover/result-card.tsx`) through our own origin.
 *
 * This exists to close a real deployment blocker: `next/image` refuses to server-optimize a remote
 * `src` unless its host is listed in `next.config.ts`'s `images.remotePatterns`, which meant every
 * newly *approved* search source (`/admin/search-sources`) still needed a code change and a deploy
 * before its photos would render — the opposite of the registration flow being "real-time". A
 * relative `src` (this route) isn't "remote" as far as `next/image` is concerned, so nothing needs
 * adding to `next.config.ts` again.
 *
 * Guarded the same way the rest of the crawler is: `safeFetchBinary` gives SSRF protection (private
 * IPs, redirect re-validation, size/time limits), and the target host must belong to a source that
 * is actually `active` and `enabled` in the registry — this is a narrow image proxy for our own
 * search results, not a general-purpose open proxy. "Belong to a source" means either the source's
 * own `domain` or one of its admin-set `imageDomains` — a source's photos are frequently hosted on a
 * separate CDN host from its pages (globesailor.ru → static.theglobesailor.com being the case that
 * surfaced this), so `domain` alone rejects perfectly legitimate photos.
 */

const ALLOWED_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"]);
// Vessel photos don't change once published; a day of browser caching plus a week at the CDN edge
// keeps repeat views cheap without risking staleness that matters for anything here.
const CACHE_CONTROL = "public, max-age=86400, s-maxage=604800, immutable";

function isAllowedHost(hostname: string, sourceDomains: string[]): boolean {
  return sourceDomains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

export async function GET(request: Request): Promise<NextResponse> {
  const rawUrl = new URL(request.url).searchParams.get("url");
  if (!rawUrl) return new NextResponse(null, { status: 400 });

  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  if (target.protocol !== "https:" && target.protocol !== "http:") {
    return new NextResponse(null, { status: 400 });
  }

  const sources = await listEnabledSources();
  const allowedDomains = sources.flatMap((source) => [source.domain, ...source.imageDomains]);
  if (!isAllowedHost(target.hostname, allowedDomains)) {
    return new NextResponse(null, { status: 403 });
  }

  const result = await safeFetchBinary(target.toString());
  if (!result.ok) return new NextResponse(null, { status: 502 });

  const contentType = result.contentType?.split(";")[0]?.trim() ?? "";
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) return new NextResponse(null, { status: 415 });

  // Buffer is a Uint8Array subclass but TS's BodyInit union doesn't accept it directly — wrap it in
  // a plain Uint8Array view rather than widen the type away.
  return new NextResponse(new Uint8Array(result.body), {
    status: 200,
    headers: { "Content-Type": contentType, "Cache-Control": CACHE_CONTROL },
  });
}
