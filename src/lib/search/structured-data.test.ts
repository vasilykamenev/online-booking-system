import { describe, expect, it } from "vitest";
import { extractJsonLdTypes } from "./structured-data";

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
