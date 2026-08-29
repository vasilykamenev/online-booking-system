import { describe, expect, it } from "vitest";
import { indexRowToResult } from "./vessel-index";

function row(overrides: Partial<Parameters<typeof indexRowToResult>[0]> = {}): Parameters<typeof indexRowToResult>[0] {
  return {
    source_id: "11111111-1111-1111-1111-111111111111",
    url: "https://brilions.com/yacht/aurora/",
    external_id: "https://brilions.com/yacht/aurora/",
    name: "Aurora",
    description: "A calm bay cruiser.",
    price_minor: 950000,
    currency: "EUR",
    guests: 8,
    cabins: 4,
    vessel_type: "MOTOR_YACHT",
    vessel_type_raw: "Motor yacht",
    manufacturer: "Azimut",
    model: "55",
    year: 2019,
    length_meters: 17.5,
    region: null,
    country: "Turkey",
    city: "Antalya",
    marina: "Setur Marina",
    latitude: 36.88,
    longitude: 30.7,
    image: "https://brilions.com/img/aurora.jpg",
    images: [],
    field_provenance: {},
    last_extracted_at: "2026-08-26T09:00:00.000Z",
    indexed_at: "2026-08-28T09:00:00.000Z",
    search_sources: { name: "Brilions", domain: "brilions.com" },
    ...overrides,
  };
}

describe("indexRowToResult", () => {
  it("builds a full external result from an indexed row, Э5-only fields included", () => {
    const result = indexRowToResult(row());

    expect(result.origin).toBe("EXTERNAL");
    expect(result.sourceId).toBe("11111111-1111-1111-1111-111111111111");
    expect(result.externalId).toBe("https://brilions.com/yacht/aurora/");
    expect(result.vesselType).toBe("MOTOR_YACHT");
    expect(result.manufacturer).toBe("Azimut");
    expect(result.model).toBe("55");
    expect(result.year).toBe(2019);
    expect(result.lengthMeters).toBe(17.5);
    expect(result.location).toEqual({
      country: "Turkey",
      region: null,
      city: "Antalya",
      marina: "Setur Marina",
      latitude: 36.88,
      longitude: 30.7,
    });
    expect(result.source).toEqual({
      type: "WEBSITE",
      name: "Brilions",
      domain: "brilions.com",
      url: "https://brilions.com/yacht/aurora/",
      retrievedAt: "2026-08-28T09:00:00.000Z",
    });
    expect(result.indexedAt).toBe("2026-08-28T09:00:00.000Z");
    // Never claimed as verified just for having been indexed — Э6's verification phase is the only
    // thing allowed to set this, and only for the request it actually ran for.
    expect(result.verifiedAt).toBeNull();
  });

  it("prefers the Э5 multi-image array over the legacy single `image` column when both are present", () => {
    const result = indexRowToResult(
      row({ image: "https://brilions.com/img/legacy.jpg", images: [{ url: "https://brilions.com/img/full.jpg", alt: "Aurora" }] }),
    );
    expect(result.images).toEqual([{ url: "https://brilions.com/img/full.jpg", alt: "Aurora" }]);
  });

  it("falls back to the legacy single `image` column when the Э5 array is empty — a pre-Э5 row the indexer hasn't revisited yet", () => {
    const result = indexRowToResult(row({ images: [] }));
    expect(result.images).toEqual([{ url: "https://brilions.com/img/aurora.jpg", alt: "Aurora" }]);
  });

  it("defaults vessel type and Э5-only location fields to null for a row the indexer never wrote", () => {
    const result = indexRowToResult(
      row({ vessel_type: null, manufacturer: null, model: null, year: null, length_meters: null, region: null, marina: null, latitude: null, longitude: null }),
    );
    expect(result.vesselType).toBeNull();
    expect(result.location.marina).toBeNull();
    expect(result.location.latitude).toBeNull();
    expect(result.location.longitude).toBeNull();
  });

  it("falls back to the source's domain as its display name when search_sources didn't embed", () => {
    const result = indexRowToResult(row({ search_sources: null }));
    expect(result.source.name).toBe("external");
    expect(result.source.domain).toBeNull();
    expect(result.id).toBe("external:https://brilions.com/yacht/aurora/");
  });
});
