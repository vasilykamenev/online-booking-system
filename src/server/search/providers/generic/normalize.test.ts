import { describe, expect, it } from "vitest";
import { normalizeGenericResult } from "./normalize";

const BASE_INPUT = {
  sourceUrl: "https://example-charter.com/yachts/sun-odyssey-440",
  sourceName: "Example Charter",
  sourceDomain: "example-charter.com",
  retrievedAt: "2026-08-23T00:00:00.000Z",
};

describe("normalizeGenericResult", () => {
  it("carries deterministic JSON-LD fields with no provenance", () => {
    const result = normalizeGenericResult({
      ...BASE_INPUT,
      fields: {
        name: "Sun Odyssey 440",
        description: "A comfortable cruiser",
        image: "https://example-charter.com/photo.jpg",
        guests: null,
        cabins: null,
        vesselTypeRaw: null,
        country: null,
        city: null,
      },
      aiConfidence: null,
    });

    expect(result.name).toBe("Sun Odyssey 440");
    expect(result.description).toBe("A comfortable cruiser");
    expect(result.images).toEqual([{ url: "https://example-charter.com/photo.jpg", alt: "Sun Odyssey 440" }]);
    expect(result.fieldProvenance).toEqual({});
    expect(result.origin).toBe("EXTERNAL");
    expect(result.source.domain).toBe("example-charter.com");
  });

  it("never maps vesselTypeRaw onto the vesselType enum", () => {
    const result = normalizeGenericResult({
      ...BASE_INPUT,
      fields: {
        name: "Blue Paradise",
        description: null,
        image: null,
        guests: 8,
        cabins: 4,
        vesselTypeRaw: "gulet",
        country: "Turkey",
        city: "Antalya",
      },
      aiConfidence: 0.8,
    });

    expect(result.vesselType).toBeNull();
    expect(result.vesselTypeRaw).toBe("gulet");
    expect(result.capacity).toEqual({ guests: 8, cabins: 4, beds: null });
    expect(result.location.country).toBe("Turkey");
    expect(result.location.city).toBe("Antalya");
  });

  it("attaches provenance/confidence to every AI-derived field when aiConfidence is set", () => {
    const result = normalizeGenericResult({
      ...BASE_INPUT,
      fields: {
        name: "Blue Paradise",
        description: null,
        image: null,
        guests: 8,
        cabins: null,
        vesselTypeRaw: "gulet",
        country: null,
        city: null,
      },
      aiConfidence: 0.7,
    });

    expect(result.fieldProvenance.name).toEqual({ sourceUrl: BASE_INPUT.sourceUrl, confidence: 0.7 });
    expect(result.fieldProvenance["capacity.guests"]).toEqual({
      sourceUrl: BASE_INPUT.sourceUrl,
      confidence: 0.7,
    });
  });

  it("leaves images empty when no image was found, rather than inventing one", () => {
    const result = normalizeGenericResult({
      ...BASE_INPUT,
      fields: {
        name: "No Photo Yacht",
        description: null,
        image: null,
        guests: null,
        cabins: null,
        vesselTypeRaw: null,
        country: null,
        city: null,
      },
      aiConfidence: null,
    });
    expect(result.images).toEqual([]);
  });
});
