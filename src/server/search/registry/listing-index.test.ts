import { describe, expect, it } from "vitest";
import { listingRowToResult, type FreshListingRow } from "./listing-index";
import type { ResultSource } from "@/lib/search/result";

const SOURCE: ResultSource = {
  type: "WEBSITE",
  name: "Brilions",
  domain: "brilions.com",
  url: "https://brilions.com/yacht/aurora/",
  retrievedAt: "2026-08-26T10:00:00.000Z",
};

function row(overrides: Partial<FreshListingRow> = {}): FreshListingRow {
  return {
    name: "Aurora",
    description: "A calm bay cruiser.",
    price_minor: 950000,
    currency: "EUR",
    guests: 8,
    cabins: 4,
    vessel_type_raw: "Motor yacht",
    country: "Turkey",
    city: "Antalya",
    image: "https://brilions.com/img/aurora.jpg",
    field_provenance: {},
    last_extracted_at: "2026-08-26T09:00:00.000Z",
    ...overrides,
  };
}

describe("listingRowToResult", () => {
  it("maps every stored field onto the canonical result shape", () => {
    const result = listingRowToResult(row(), SOURCE);

    expect(result.origin).toBe("EXTERNAL");
    expect(result.name).toBe("Aurora");
    expect(result.description).toBe("A calm bay cruiser.");
    expect(result.vesselTypeRaw).toBe("Motor yacht");
    expect(result.capacity).toEqual({ guests: 8, cabins: 4, beds: null });
    expect(result.location).toEqual({
      country: "Turkey",
      region: null,
      city: "Antalya",
      marina: null,
      latitude: null,
      longitude: null,
    });
    expect(result.rental.priceMinor).toBe(950000);
    expect(result.rental.currency).toBe("EUR");
    expect(result.images).toEqual([{ url: "https://brilions.com/img/aurora.jpg", alt: "Aurora" }]);
  });

  it("produces no image entry when the row never stored one", () => {
    const result = listingRowToResult(row({ image: null }), SOURCE);
    expect(result.images).toEqual([]);
  });

  it("carries provenance only for fields whose last extraction came from AI", () => {
    const result = listingRowToResult(
      row({
        field_provenance: {
          name: { source: "JSON_LD", confidence: 0.9, retrievedAt: "2026-08-26T09:00:00.000Z", sourceUrl: SOURCE.url },
          guests: { source: "AI", confidence: 0.72, retrievedAt: "2026-08-26T09:00:00.000Z", sourceUrl: SOURCE.url },
        },
      }),
      SOURCE,
    );

    expect(result.fieldProvenance.name).toBeUndefined();
    expect(result.fieldProvenance["capacity.guests"]).toEqual({
      sourceUrl: SOURCE.url,
      confidence: 0.72,
    });
  });

  it("leaves fieldProvenance empty when nothing in the row came from AI", () => {
    const result = listingRowToResult(row(), SOURCE);
    expect(result.fieldProvenance).toEqual({});
  });
});
