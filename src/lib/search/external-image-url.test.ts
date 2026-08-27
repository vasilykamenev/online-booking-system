import { describe, expect, it } from "vitest";
import { decodeExternalImageUrl, encodeExternalImageUrl } from "./external-image-url";

describe("encodeExternalImageUrl / decodeExternalImageUrl", () => {
  it("round-trips a typical image URL", () => {
    const url = "https://sailica-media.fsn1.your-objectstorage.com/1375420207400809/original/a8ddb.jpg";
    expect(decodeExternalImageUrl(encodeExternalImageUrl(url))).toBe(url);
  });

  it("round-trips a URL with a query string of its own", () => {
    const url = "https://static.theglobesailor.com/1200x630/filters:quality(70)/destination/857ee8.jpg";
    expect(decodeExternalImageUrl(encodeExternalImageUrl(url))).toBe(url);
  });

  it("never contains a slash, plus, or padding character — safe as a single path segment", () => {
    const url = "https://example.com/a/b/c.jpg?x=1&y=2";
    const encoded = encodeExternalImageUrl(url);
    expect(encoded).not.toMatch(/[/+=]/);
  });

  it("returns null for a segment that isn't valid base64url", () => {
    expect(decodeExternalImageUrl("not!!valid==base64")).toBeNull();
  });

  // Reproduces a production outage: `btoa` only handles Latin1 (byte values 0-255) — a URL whose
  // path/filename has a non-Latin1 character (schema.org's `image` is not guaranteed to already be
  // percent-encoded, unlike a `new URL(...).toString()`) made the unescaped version throw
  // `InvalidCharacterError`, uncaught, during `result-card.tsx`'s render — taking down all of
  // `/discover`, not just the one broken image.
  it("round-trips a URL containing non-Latin1 characters without throwing", () => {
    const url = "https://example.com/фото/яхта-мечта.jpg";
    expect(() => encodeExternalImageUrl(url)).not.toThrow();
    expect(decodeExternalImageUrl(encodeExternalImageUrl(url))).toBe(url);
  });

  it("round-trips a URL containing emoji (surrogate-pair characters)", () => {
    const url = "https://example.com/photo-⛵.jpg";
    expect(decodeExternalImageUrl(encodeExternalImageUrl(url))).toBe(url);
  });
});
