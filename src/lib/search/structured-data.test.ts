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
  const NO_PRICE = { price: null, currency: null, priceConflict: false };

  it("extracts name/description/image from a plain Product node", () => {
    const html = `<script type="application/ld+json">
      {"@type":"Product","name":"Sun Odyssey 440","description":"A comfortable cruiser","image":"https://example.com/photo.jpg"}
    </script>`;
    expect(extractJsonLdFields(html)).toEqual({
      name: "Sun Odyssey 440",
      description: "A comfortable cruiser",
      image: "https://example.com/photo.jpg",
      ...NO_PRICE,
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
      ...NO_PRICE,
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
      ...NO_PRICE,
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

  describe("price/offers", () => {
    it("reads price and currency from an inline Offer", () => {
      const html = `<script type="application/ld+json">
        {"@type":"Product","name":"Ocean Explorer","offers":{"@type":"Offer","price":"12500","priceCurrency":"eur"}}
      </script>`;
      const result = extractJsonLdFields(html);
      expect(result?.price).toBe(12500);
      expect(result?.currency).toBe("EUR");
      expect(result?.priceConflict).toBe(false);
    });

    it("accepts a numeric price as well as a string one", () => {
      const html = `<script type="application/ld+json">
        {"@type":"Product","name":"Aurora","offers":{"price":9500,"priceCurrency":"EUR"}}
      </script>`;
      expect(extractJsonLdFields(html)?.price).toBe(9500);
    });

    it("picks the cheapest offer when offers is an array of rate variants", () => {
      const html = `<script type="application/ld+json">
        {"@type":"Product","name":"Catamaran X","offers":[
          {"price":"11000","priceCurrency":"EUR"},
          {"price":"9500","priceCurrency":"EUR"},
          {"price":"15000","priceCurrency":"EUR"}
        ]}
      </script>`;
      expect(extractJsonLdFields(html)?.price).toBe(9500);
    });

    it("ignores an offer declared out of stock in favor of an available one", () => {
      const html = `<script type="application/ld+json">
        {"@type":"Product","name":"Catamaran X","offers":[
          {"price":"7000","priceCurrency":"EUR","availability":"https://schema.org/OutOfStock"},
          {"price":"9500","priceCurrency":"EUR","availability":"https://schema.org/InStock"}
        ]}
      </script>`;
      expect(extractJsonLdFields(html)?.price).toBe(9500);
    });

    it("returns no price when every offer is out of stock, rather than a stale one", () => {
      const html = `<script type="application/ld+json">
        {"@type":"Product","name":"Catamaran X","offers":{"price":"9500","priceCurrency":"EUR","availability":"https://schema.org/SoldOut"}}
      </script>`;
      const result = extractJsonLdFields(html);
      expect(result?.price).toBeNull();
      expect(result?.currency).toBeNull();
    });

    it("resolves an offer given only as an @id reference elsewhere in the same document", () => {
      const html = `<script type="application/ld+json">
        {"@graph":[
          {"@type":"Product","name":"Ocean Explorer","offers":{"@id":"https://example.com/#offer"}},
          {"@type":"Offer","@id":"https://example.com/#offer","price":"12500","priceCurrency":"EUR"}
        ]}
      </script>`;
      const result = extractJsonLdFields(html);
      expect(result?.price).toBe(12500);
      expect(result?.currency).toBe("EUR");
    });

    it("ignores an unparseable price without failing the rest of the extraction", () => {
      const html = `<script type="application/ld+json">
        {"@type":"Product","name":"Catamaran X","offers":{"price":"call for price","priceCurrency":"EUR"}}
      </script>`;
      const result = extractJsonLdFields(html);
      expect(result?.name).toBe("Catamaran X");
      expect(result?.price).toBeNull();
    });

    it("flags a conflict and drops the price when two different listing blocks disagree", () => {
      const html = `
        <script type="application/ld+json">
          {"@type":"Product","name":"Ocean Explorer","offers":{"price":"8000","priceCurrency":"EUR"}}
        </script>
        <script type="application/ld+json">
          {"@type":"Product","name":"Ocean Explorer","offers":{"price":"11000","priceCurrency":"EUR"}}
        </script>
      `;
      const result = extractJsonLdFields(html);
      expect(result?.priceConflict).toBe(true);
      expect(result?.price).toBeNull();
      expect(result?.currency).toBeNull();
      // The conflict must not hide the rest of the (still reliable) fields.
      expect(result?.name).toBe("Ocean Explorer");
    });

    it("does not flag a conflict when multiple offers simply have different currencies for the same node", () => {
      // Same node, one offer — not two disagreeing listing blocks.
      const html = `<script type="application/ld+json">
        {"@type":"Product","name":"Catamaran X","offers":{"price":"9500","priceCurrency":"EUR"}}
      </script>`;
      expect(extractJsonLdFields(html)?.priceConflict).toBe(false);
    });
  });
});
