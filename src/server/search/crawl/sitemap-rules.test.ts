import { describe, expect, it } from "vitest";
import {
  countSitemapLocs,
  getSitemapRootKind,
  looksLikeSitemap,
  parseSitemapEntries,
  sampleSitemapLocs,
} from "./sitemap-rules";

const URLSET_SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/a</loc></url>
  <url><loc>https://example.com/b</loc></url>
</urlset>`;

const SITEMAP_INDEX_SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://example.com/sitemap-1.xml</loc></sitemap>
</sitemapindex>`;

const HTML_404_SAMPLE = "<html><body><h1>404 Not Found</h1></body></html>";

describe("countSitemapLocs", () => {
  it("counts every <loc> entry", () => {
    expect(countSitemapLocs(URLSET_SAMPLE)).toBe(2);
  });

  it("returns 0 for a document with no <loc> entries", () => {
    expect(countSitemapLocs(HTML_404_SAMPLE)).toBe(0);
  });
});

describe("looksLikeSitemap", () => {
  it("accepts a <urlset> document", () => {
    expect(looksLikeSitemap(URLSET_SAMPLE)).toBe(true);
  });

  it("accepts a <sitemapindex> document", () => {
    expect(looksLikeSitemap(SITEMAP_INDEX_SAMPLE)).toBe(true);
  });

  it("rejects an HTML error page served with a 200 for a guessed sitemap path", () => {
    expect(looksLikeSitemap(HTML_404_SAMPLE)).toBe(false);
  });

  it("rejects an empty <urlset> with no entries", () => {
    expect(
      looksLikeSitemap(
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>',
      ),
    ).toBe(false);
  });
});

describe("sampleSitemapLocs", () => {
  it("caps the result at the given limit", () => {
    expect(sampleSitemapLocs(URLSET_SAMPLE, 1)).toEqual(["https://example.com/a"]);
  });

  it("excludes the given base URL when present", () => {
    const xml = `<urlset><url><loc>https://example.com/</loc></url><url><loc>https://example.com/a</loc></url></urlset>`;
    expect(sampleSitemapLocs(xml, 5, "https://example.com/")).toEqual([
      "https://example.com/a",
    ]);
  });

  it("returns an empty array when the sitemap has no entries", () => {
    expect(sampleSitemapLocs(HTML_404_SAMPLE, 3)).toEqual([]);
  });
});

describe("getSitemapRootKind", () => {
  it("identifies a urlset document", () => {
    expect(getSitemapRootKind(URLSET_SAMPLE)).toBe("urlset");
  });

  it("identifies a sitemapindex document", () => {
    expect(getSitemapRootKind(SITEMAP_INDEX_SAMPLE)).toBe("sitemapindex");
  });

  it("returns null for neither", () => {
    expect(getSitemapRootKind(HTML_404_SAMPLE)).toBeNull();
  });
});

describe("parseSitemapEntries", () => {
  it("pairs each <loc> with its own <lastmod>, not any other entry's", () => {
    const xml = `<urlset>
      <url><loc>https://example.com/a</loc><lastmod>2026-01-01</lastmod></url>
      <url><loc>https://example.com/b</loc></url>
    </urlset>`;
    expect(parseSitemapEntries(xml)).toEqual([
      { loc: "https://example.com/a", lastmod: "2026-01-01" },
      { loc: "https://example.com/b", lastmod: null },
    ]);
  });

  it("parses <sitemap> blocks from a sitemapindex the same way", () => {
    const xml = `<sitemapindex>
      <sitemap><loc>https://example.com/sitemap-1.xml</loc><lastmod>2026-02-02</lastmod></sitemap>
    </sitemapindex>`;
    expect(parseSitemapEntries(xml)).toEqual([
      { loc: "https://example.com/sitemap-1.xml", lastmod: "2026-02-02" },
    ]);
  });

  it("returns an empty array for a document with no <url>/<sitemap> blocks", () => {
    expect(parseSitemapEntries(HTML_404_SAMPLE)).toEqual([]);
  });
});
