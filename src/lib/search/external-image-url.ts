/**
 * URL-safe encode/decode for `api/external-image`'s target URL, carried as a path segment rather
 * than a query string — specifically so `next.config.ts`'s `images.localPatterns` can allow-list the
 * route and Next's built-in image optimizer can resize/reformat external photos the same way it
 * already does for internal ones. A query string (`?url=...`) doesn't work for this: `LocalPattern`'s
 * `search` can only be one literal value (no wildcard — checked against
 * `node_modules/next/dist/shared/lib/image-config.d.ts`), but every photo needs a different `url`.
 * `pathname` *does* support a wildcard (`/**`), so moving the target URL into the path sidesteps the
 * limitation entirely.
 *
 * Plain `btoa`/`atob` rather than `Buffer` — this runs in both a client component
 * (`discover/result-card.tsx`, building the `src`) and a route handler (decoding it), and both are
 * globally available in every browser and in modern Node. Safe for what it actually encodes:
 * `image.url` is always a resolved `URL#toString()` (from `safeFetch`/JSON-LD extraction), which the
 * URL spec guarantees is ASCII — non-ASCII characters are already percent-encoded by that point — so
 * no UTF-8 escaping step is needed before base64.
 */

export function encodeExternalImageUrl(url: string): string {
  return btoa(url).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** `null` for a segment that isn't valid base64url (tampered or malformed) — the route handler
 *  treats that as a 400, same as any other malformed input. */
export function decodeExternalImageUrl(segment: string): string | null {
  try {
    const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    return atob(padded);
  } catch {
    return null;
  }
}
