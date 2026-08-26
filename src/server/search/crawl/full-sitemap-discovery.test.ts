import { describe, expect, it, vi } from "vitest";
import type { SafeFetchResult } from "./safe-fetch";

const { safeFetch } = vi.hoisted(() => ({ safeFetch: vi.fn() }));
vi.mock("./safe-fetch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./safe-fetch")>()),
  safeFetch,
}));

const { discoverAllSitemapEntries } = await import("./full-sitemap-discovery");

function ok(body: string): SafeFetchResult {
  return { ok: true, status: 200, finalUrl: "irrelevant", body, etag: null, lastModified: null };
}

function urlset(locs: string[]): string {
  return `<urlset>${locs.map((loc) => `<url><loc>${loc}</loc></url>`).join("")}</urlset>`;
}

function sitemapindex(locs: string[]): string {
  return `<sitemapindex>${locs.map((loc) => `<sitemap><loc>${loc}</loc></sitemap>`).join("")}</sitemapindex>`;
}

describe("discoverAllSitemapEntries", () => {
  it("returns entries directly from a single urlset with no recursion needed", async () => {
    safeFetch.mockResolvedValueOnce(ok(urlset(["https://example.com/a", "https://example.com/b"])));

    const result = await discoverAllSitemapEntries("https://example.com", ["https://example.com/sitemap.xml"]);

    expect(result.entries.map((e) => e.loc)).toEqual(["https://example.com/a", "https://example.com/b"]);
    expect(result.entries[0].sourceSitemap).toBe("https://example.com/sitemap.xml");
    expect(result.truncated).toBe(false);
  });

  it("recurses into a sitemapindex and merges its children's entries", async () => {
    safeFetch
      .mockResolvedValueOnce(
        ok(sitemapindex(["https://example.com/sitemap-1.xml", "https://example.com/sitemap-2.xml"])),
      )
      .mockResolvedValueOnce(ok(urlset(["https://example.com/a"])))
      .mockResolvedValueOnce(ok(urlset(["https://example.com/b"])));

    const result = await discoverAllSitemapEntries("https://example.com", ["https://example.com/sitemap-index.xml"]);

    expect(result.entries.map((e) => e.loc).sort()).toEqual(["https://example.com/a", "https://example.com/b"]);
    expect(result.truncated).toBe(false);
  });

  it("stops recursing past MAX_SITEMAP_DEPTH and marks the result truncated", async () => {
    // Each index points at a distinct, never-before-seen child index — so only MAX_SITEMAP_DEPTH's
    // bound (not the already-visited dedup) can be what stops this from recursing forever.
    let depth = 0;
    safeFetch.mockImplementation(async () => {
      depth += 1;
      return ok(sitemapindex([`https://example.com/sitemap-index-${depth}.xml`]));
    });

    const result = await discoverAllSitemapEntries("https://example.com", ["https://example.com/sitemap-index-0.xml"]);

    expect(result.entries).toEqual([]);
    expect(result.truncated).toBe(true);
  });

  it("ignores an unfetchable/malformed sitemap without throwing", async () => {
    safeFetch.mockResolvedValueOnce({ ok: false, reason: "http-error", status: 404 });

    const result = await discoverAllSitemapEntries("https://example.com", ["https://example.com/sitemap.xml"]);

    expect(result.entries).toEqual([]);
  });
});
