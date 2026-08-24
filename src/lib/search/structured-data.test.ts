import { describe, expect, it } from "vitest";
import { extractJsonLdFields, extractJsonLdTypes } from "./structured-data";

describe("extractJsonLdTypes", () => {
  it("extracts a single @type", () => {
    const html = `<html><head><script type="application/ld+json">
      {"@context":"https://schema.org","@type":"Product","name":"Sun Odyssey 440"}
    </script></head></html>`;
    expect(extractJsonLdTypes(html)).toEqual(["Product"]);
  });

  it("collects types nested inside @graph", () => {
    const html = `<script type="application/ld+json">
      {"@context":"https://schema.org","@graph":[
        {"@type":"Organization","name":"Example Charter"},
        {"@type":"Product","name":"Catamaran"}
      ]}
    </script>`;
    expect(extractJsonLdTypes(html).sort()).toEqual(["Organization", "Product"]);
  });

  it("merges types across multiple script blocks and de-duplicates", () => {
    const html = `
      <script type="application/ld+json">{"@type":"Product"}</script>
      <script type='application/ld+json'>{"@type":"Product"}</script>
      <script type="application/ld+json">{"@type":"Offer"}</script>
    `;
    expect(extractJsonLdTypes(html).sort()).toEqual(["Offer", "Product"]);
  });

  it("ignores a malformed block without failing the others", () => {
    const html = `
      <script type="application/ld+json">{not valid json}</script>
      <script type="application/ld+json">{"@type":"Product"}</script>
    `;
    expect(extractJsonLdTypes(html)).toEqual(["Product"]);
  });

  it("returns an empty array when the page has no JSON-LD", () => {
    expect(extractJsonLdTypes("<html><body><h1>Hello</h1></body></html>")).toEqual([]);
  });
});

describe("extractJsonLdFields", () => {
  it("extracts name/description/image from a plain Product node", () => {
    const html = `<script type="application/ld+json">
      {"@type":"Product","name":"Sun Odyssey 440","description":"A comfortable cruiser","image":"https://example.com/photo.jpg"}
    </script>`;
    expect(extractJsonLdFields(html)).toEqual({
      name: "Sun Odyssey 440",
      description: "A comfortable cruiser",
      image: "https://example.com/photo.jpg",
    });
  });

  it("finds the first named node inside @graph", () => {
    const html = `<script type="application/ld+json">
      {"@graph":[{"@type":"Organization"},{"@type":"Product","name":"Catamaran X","image":["https://example.com/a.jpg","https://example.com/b.jpg"]}]}
    </script>`;
    expect(extractJsonLdFields(html)).toEqual({
      name: "Catamaran X",
      description: null,
      image: "https://example.com/a.jpg",
    });
  });

  it("reads an ImageObject's url when image is not a bare string", () => {
    const html = `<script type="application/ld+json">
      {"name":"Gulet Mavi","image":{"@type":"ImageObject","url":"https://example.com/mavi.jpg"}}
    </script>`;
    expect(extractJsonLdFields(html)?.image).toBe("https://example.com/mavi.jpg");
  });

  it("returns null when no JSON-LD node has a name", () => {
    const html = `<script type="application/ld+json">{"@type":"Organization"}</script>`;
    expect(extractJsonLdFields(html)).toBeNull();
  });

  it("skips a site-wide Organization/TravelAgency block in favor of the page's own listing, regardless of document order", () => {
    // Reproduces globesailor.ru: every page carries a page-wide `TravelAgency` block (site name, no
    // `image`) ahead of the page-specific `Product` block — before this fix, the org block's name
    // ("GlobeSailor") and missing image leaked into every single result from the source.
    const html = `
      <script type="application/ld+json">
        {"@type":"TravelAgency","name":"GlobeSailor","url":"https://www.globesailor.ru/"}
      </script>
      <script type="application/ld+json">
        {"@type":"Product","name":"Аренда яхты Гренада","image":"https://example.com/grenada.jpg"}
      </script>
    `;
    expect(extractJsonLdFields(html)).toEqual({
      name: "Аренда яхты Гренада",
      description: null,
      image: "https://example.com/grenada.jpg",
    });
  });

  it("skips a named Organization node inside the same @graph as the real listing", () => {
    const html = `<script type="application/ld+json">
      {"@graph":[
        {"@type":"Organization","name":"GlobeSailor"},
        {"@type":"Product","name":"Catamaran X","image":"https://example.com/a.jpg"}
      ]}
    </script>`;
    expect(extractJsonLdFields(html)?.name).toBe("Catamaran X");
  });

  it("returns null when the page has no JSON-LD at all", () => {
    expect(extractJsonLdFields("<html><body>text</body></html>")).toBeNull();
  });
});
