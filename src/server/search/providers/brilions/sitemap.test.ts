import { describe, expect, it } from "vitest";
import { parseYachtSitemap } from "./sitemap";

// A trimmed-down stand-in for the real yacht-sitemap.xml (601 <loc> entries observed during
// integration research) — enough shape to exercise every branch: paired ru/en, ru-only, a
// non-city-prefixed slug, the archive-root URLs that must be skipped, and an unrelated <loc>.
const SAMPLE_SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://brilions.com/yacht/</loc></url>
  <url><loc>https://brilions.com/en/yacht/</loc></url>
  <url><loc>https://brilions.com/yacht/antalya-adelya/</loc></url>
  <url><loc>https://brilions.com/en/yacht/antalya-adelya/</loc></url>
  <url><loc>https://brilions.com/yacht/antalya-savas/</loc></url>
  <url><loc>https://brilions.com/yacht/gulet-blue-cruise-01/</loc></url>
  <url><loc>https://brilions.com/en/yacht/gulet-blue-cruise-01/</loc></url>
  <url><loc>https://brilions.com/sitemap_index.xml</loc></url>
</urlset>`;

describe("parseYachtSitemap", () => {
  const entries = parseYachtSitemap(SAMPLE_SITEMAP);

  it("skips the bare archive-root URLs, keeping only vessel detail pages", () => {
    expect(entries.some((entry) => entry.urlRu.endsWith("/yacht/"))).toBe(false);
  });

  it("ignores an unrelated <loc> that doesn't match the detail-page pattern", () => {
    expect(entries.some((entry) => entry.urlRu.includes("sitemap_index"))).toBe(false);
  });

  it("pairs the Russian and English URLs for the same slug into one entry", () => {
    const adelya = entries.find((entry) => entry.slug === "antalya-adelya");
    expect(adelya).toMatchObject({
      urlRu: "https://brilions.com/yacht/antalya-adelya/",
      urlEn: "https://brilions.com/en/yacht/antalya-adelya/",
    });
  });

  it("still includes a vessel with no English translation, with urlEn null", () => {
    const savas = entries.find((entry) => entry.slug === "antalya-savas");
    expect(savas).toMatchObject({ urlRu: "https://brilions.com/yacht/antalya-savas/", urlEn: null });
  });

  it("derives the city-slug guess as the first hyphen-delimited segment", () => {
    const adelya = entries.find((entry) => entry.slug === "antalya-adelya");
    expect(adelya?.citySlugGuess).toBe("antalya");
  });

  it("does not fail on a slug that isn't actually city-prefixed", () => {
    // "gulet" here names a boat category, not a city — parseYachtSitemap doesn't know that, and
    // isn't supposed to: it's a pure guess for the provider to use as a pre-filter, not ground truth.
    const gulet = entries.find((entry) => entry.slug === "gulet-blue-cruise-01");
    expect(gulet?.citySlugGuess).toBe("gulet");
  });

  it("produces exactly one entry per distinct slug", () => {
    expect(entries).toHaveLength(3);
  });
});
