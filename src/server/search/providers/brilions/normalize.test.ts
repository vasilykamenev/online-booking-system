import { describe, expect, it } from "vitest";
import { normalizeBrilionsResult } from "./normalize";
import type { DeterministicExtraction } from "./extract";
import { emptyAmenitiesExtraction, type AmenitiesExtraction } from "./amenities-extraction";

const FULL_DETERMINISTIC: DeterministicExtraction = {
  name: "ЯХТА ADELYA — АНТАЛИЯ",
  vesselTypeRaw: "Моторные яхты",
  city: "Анталия",
  year: 2006,
  lengthMeters: 20,
  guests: 20,
  cabins: 3,
  description: "Аренда яхты Adelya в Анталии",
  images: ["https://brilions.com/wp-content/uploads/2025/04/Adelya_01.jpg"],
  amenitiesText: "Экипаж: капитан, шеф-повар",
};

const RICH_AMENITIES: AmenitiesExtraction = {
  features: ["wifi", "air_conditioning"],
  captainIncluded: true,
  crewIncluded: true,
  confidence: 0.9,
};

function normalize(overrides: Partial<Parameters<typeof normalizeBrilionsResult>[0]> = {}) {
  return normalizeBrilionsResult({
    vesselId: "antalya-adelya",
    sourceUrl: "https://brilions.com/yacht/antalya-adelya/",
    retrievedAt: "2026-08-21T00:00:00.000Z",
    citySlugGuess: "antalya",
    deterministic: FULL_DETERMINISTIC,
    amenities: emptyAmenitiesExtraction,
    ...overrides,
  });
}

describe("normalizeBrilionsResult — provenance and origin", () => {
  it("marks the result as EXTERNAL with source attribution (spec §14)", () => {
    const result = normalize();
    expect(result.origin).toBe("EXTERNAL");
    expect(result.source).toMatchObject({
      type: "WEBSITE",
      domain: "brilions.com",
      url: "https://brilions.com/yacht/antalya-adelya/",
    });
  });

  it("always leaves price null — the site publishes no pricing anywhere", () => {
    const result = normalize();
    expect(result.rental.priceMinor).toBeNull();
    expect(result.rental.currency).toBeNull();
  });

  it("carries over the deterministic fields directly", () => {
    const result = normalize();
    expect(result.name).toBe("ЯХТА ADELYA — АНТАЛИЯ");
    expect(result.year).toBe(2006);
    expect(result.capacity).toEqual({ guests: 20, cabins: 3, beds: null });
  });
});

describe("normalizeBrilionsResult — vessel type mapping", () => {
  it("maps a recognized raw type onto the project's own enum", () => {
    expect(normalize().vesselType).toBe("MOTOR_YACHT");
  });

  it("keeps an unrecognized raw type as vesselTypeRaw without forcing an enum value", () => {
    const result = normalize({
      deterministic: { ...FULL_DETERMINISTIC, vesselTypeRaw: "Спортивный катер" },
    });
    expect(result.vesselType).toBeNull();
    expect(result.vesselTypeRaw).toBe("Спортивный катер");
  });
});

describe("normalizeBrilionsResult — country from city-slug", () => {
  it("resolves a known Turkish city slug to Turkey", () => {
    expect(normalize({ citySlugGuess: "bodrum" }).location.country).toBe("Turkey");
  });

  it("resolves a known UAE city slug to the UAE", () => {
    expect(normalize({ citySlugGuess: "dubai" }).location.country).toBe("United Arab Emirates");
  });

  it("leaves country null for an unrecognized slug rather than guessing", () => {
    // "gulet" names a boat category in some slugs, not a city — the normalizer must not pretend
    // to know the country just because most slugs happen to be city-prefixed.
    expect(normalize({ citySlugGuess: "gulet" }).location.country).toBeNull();
  });
});

describe("normalizeBrilionsResult — AI-derived fields carry provenance (spec §14-15)", () => {
  it("attaches source and confidence to features/crew fields when AI extraction found something", () => {
    const result = normalize({ amenities: RICH_AMENITIES });
    expect(result.features).toEqual(["wifi", "air_conditioning"]);
    expect(result.rental.captainIncluded).toBe(true);
    expect(result.fieldProvenance.features).toEqual({
      sourceUrl: "https://brilions.com/yacht/antalya-adelya/",
      confidence: 0.9,
    });
    expect(result.fieldProvenance["rental.captainIncluded"].confidence).toBe(0.9);
  });

  it("carries no provenance entries when AI extraction found nothing", () => {
    const result = normalize({ amenities: emptyAmenitiesExtraction });
    expect(result.fieldProvenance).toEqual({});
  });
});
