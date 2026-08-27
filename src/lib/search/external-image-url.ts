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
 * globally available in every browser and in modern Node.
 *
 * `btoa`/`atob` only handle Latin1 (byte values 0-255), not arbitrary Unicode — and unlike a URL
 * built through `new URL(...).toString()`, a source's own JSON-LD `image` value is *not* guaranteed
 * to already be percent-encoded (schema.org states no such requirement, and real sites don't all
 * bother). A raw non-ASCII byte (any URL whose path/filename has a non-Latin1 character) made
 * `btoa` throw `InvalidCharacterError` — uncaught, during `result-card.tsx`'s render, which took the
 * entire `/discover` page down with it in production. `encodeURIComponent`/`decodeURIComponent`
 * around the base64 step (the standard MDN-documented "Unicode-safe base64" pattern) fixes this by
 * always feeding `btoa`/`atob` a genuine byte-per-character string, regardless of what the source
 * actually put in the URL.
 */

export function encodeExternalImageUrl(url: string): string {
  const byteString = encodeURIComponent(url).replace(/%([0-9A-F]{2})/g, (_, hex: string) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
  return btoa(byteString).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** `null` for a segment that isn't valid base64url (tampered or malformed) — the route handler
 *  treats that as a 400, same as any other malformed input. */
export function decodeExternalImageUrl(segment: string): string | null {
  try {
    const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const byteString = atob(padded);
    const percentEncoded = Array.from(byteString, (char) => `%${char.charCodeAt(0).toString(16).padStart(2, "0")}`).join("");
    return decodeURIComponent(percentEncoded);
  } catch {
    return null;
  }
}
