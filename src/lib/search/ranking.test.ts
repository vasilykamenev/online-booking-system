import { describe, expect, it } from "vitest";
import { emptyResult, type ResultSource, type VesselSearchResult } from "./offer";
import { searchCriteriaSchema, type SearchCriteria } from "./request";
import {
  INTERNAL_ORIGIN_BONUS,
  rankResults,
  scoreAmenities,
  scoreCapacity,
  scoreDate,
  scorePrice,
  scoreResult,
  scoreVesselType,
} from "./ranking";

const internalSource: ResultSource = {
  type: "INTERNAL",
  name: "Meridian",
  domain: null,
  url: "/vessels/adriatic-dream",
  retrievedAt: "2026-08-21T00:00:00.000Z",
};

const externalSource: ResultSource = {
  type: "WEBSITE",
  name: "Example Charter",
  domain: "example.com",
  url: "https://example.com/yacht/123",
  retrievedAt: "2026-08-21T00:00:00.000Z",
};

function makeResult(overrides: Partial<VesselSearchResult> = {}): VesselSearchResult {
  const base = emptyResult(overrides.id ?? "r1", overrides.origin ?? "EXTERNAL", overrides.source ?? externalSource);
  return { ...base, ...overrides };
}

function criteria(partial: Record<string, unknown>): SearchCriteria {
  return searchCriteriaSchema.parse(partial);
}

describe("scorePrice", () => {
  it("gives a full score to anything within budget", () => {
    const result = makeResult({ rental: { ...emptyResult("r1", "EXTERNAL", externalSource).rental, priceMinor: 400_000, currency: "EUR" } });
    expect(scorePrice(result, criteria({ price: { max: 5000, currency: "EUR" } }))).toBe(1);
  });

  it("fades out as the price exceeds the budget", () => {
    const result = makeResult({ rental: { ...emptyResult("r1", "EXTERNAL", externalSource).rental, priceMinor: 600_000, currency: "EUR" } });
    const score = scorePrice(result, criteria({ price: { max: 5000, currency: "EUR" } }));
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it("does not score across mismatched currencies instead of guessing an FX rate", () => {
    const result = makeResult({ rental: { ...emptyResult("r1", "EXTERNAL", externalSource).rental, priceMinor: 400_000, currency: "RUB" } });
    expect(scorePrice(result, criteria({ price: { max: 5000, currency: "EUR" } }))).toBeNull();
  });

  it("is not applicable when the query said nothing about price", () => {
    const result = makeResult({ rental: { ...emptyResult("r1", "EXTERNAL", externalSource).rental, priceMinor: 400_000, currency: "EUR" } });
    expect(scorePrice(result, criteria({}))).toBeNull();
  });
});

describe("scoreCapacity", () => {
  const withGuests = (guests: number) =>
    makeResult({ capacity: { guests, cabins: null, beds: null } });

  it("fully matches a vessel that fits the party", () => {
    expect(scoreCapacity(withGuests(6), criteria({ capacity: { persons: 6 } }))).toBe(1);
  });

  it("heavily penalises a vessel too small for the party", () => {
    expect(scoreCapacity(withGuests(4), criteria({ capacity: { persons: 6 } }))).toBeLessThan(0.2);
  });

  it("mildly penalises a vessel far larger than needed", () => {
    const score = scoreCapacity(withGuests(30), criteria({ capacity: { persons: 4 } }));
    expect(score).toBeLessThan(1);
    expect(score).toBeGreaterThan(0);
  });
});

describe("scoreDate", () => {
  const availableInSeptember = makeResult({ availability: { from: "2026-09-01", to: "2026-09-30" } });

  it("matches an exact window that overlaps availability", () => {
    expect(scoreDate(availableInSeptember, criteria({ date: { from: "2026-09-05", to: "2026-09-12" } }))).toBe(1);
  });

  it("rejects an exact window outside availability", () => {
    expect(scoreDate(availableInSeptember, criteria({ date: { from: "2026-11-05", to: "2026-11-12" } }))).toBe(0);
  });

  it("matches a bare month against the availability window", () => {
    expect(scoreDate(availableInSeptember, criteria({ date: { month: 9 } }))).toBe(1);
    expect(scoreDate(availableInSeptember, criteria({ date: { month: 3 } }))).toBe(0);
  });

  it("is not applicable when availability is unknown", () => {
    expect(scoreDate(makeResult(), criteria({ date: { month: 9 } }))).toBeNull();
  });
});

describe("scoreVesselType", () => {
  it("matches when the result's type is any of several requested ones", () => {
    const catamaran = makeResult({ vesselType: "CATAMARAN" });
    expect(scoreVesselType(catamaran, criteria({ vesselTypes: ["MOTOR_YACHT", "CATAMARAN"] }))).toBe(1);
  });

  it("scores zero for a type outside the requested list", () => {
    const catamaran = makeResult({ vesselType: "CATAMARAN" });
    expect(scoreVesselType(catamaran, criteria({ vesselTypes: ["MOTOR_YACHT"] }))).toBe(0);
  });

  it("is not applicable when the query named no vessel type", () => {
    const catamaran = makeResult({ vesselType: "CATAMARAN" });
    expect(scoreVesselType(catamaran, criteria({}))).toBeNull();
  });
});

describe("scoreAmenities", () => {
  it("scores the fraction of requested amenities the result actually has", () => {
    const result = makeResult({ features: ["wifi", "aircon"] });
    expect(scoreAmenities(result, criteria({ amenities: ["wifi", "diving"] }))).toBe(0.5);
  });

  it("is not applicable when the query named no amenities", () => {
    const result = makeResult({ features: ["wifi"] });
    expect(scoreAmenities(result, criteria({}))).toBeNull();
  });
});

describe("scoreResult", () => {
  it("renormalizes so a single satisfied criterion yields a high score", () => {
    const result = makeResult({
      name: "Adriatic Dream",
      location: { country: "Greece", region: null, city: null, marina: null, latitude: null, longitude: null },
    });
    const { score } = scoreResult(result, criteria({ location: { country: "Greece" } }));
    // Location carries weight 0.20 of 1.0, but with only three factors applicable the match must
    // not be diluted down to 0.2 — that is the whole point of dropping inapplicable factors.
    expect(score).toBeGreaterThan(0.5);
  });

  it("ignores case and diacritics when matching a location label", () => {
    const result = makeResult({
      location: { country: "ГРЕЦИЯ", region: null, city: null, marina: null, latitude: null, longitude: null },
    });
    expect(scoreResult(result, criteria({ location: { country: "Греция" } })).breakdown.location).toBe(1);
  });

  it("uses per-domain reliability for external sources", () => {
    const result = makeResult();
    const trusted = scoreResult(result, criteria({}), { sourceReliability: { "example.com": 1 } });
    const untrusted = scoreResult(result, criteria({}), { sourceReliability: { "example.com": 0.1 } });
    expect(trusted.score).toBeGreaterThan(untrusted.score);
  });
});

describe("rankResults", () => {
  it("prefers an internal result over an equally good external one, by a small margin", () => {
    const shared = {
      name: "Adriatic Dream",
      capacity: { guests: 6, cabins: 3, beds: null },
      location: { country: "Greece", region: null, city: null, marina: null, latitude: null, longitude: null },
    };
    const [first, second] = rankResults(
      [
        makeResult({ id: "external", origin: "EXTERNAL", source: externalSource, ...shared }),
        makeResult({ id: "internal", origin: "INTERNAL", source: internalSource, ...shared }),
      ],
      criteria({ location: { country: "Greece" }, capacity: { persons: 6 } }),
      { sourceReliability: { "example.com": 1 } },
    );

    expect(first.id).toBe("internal");
    expect(first.ranking!.score - second.ranking!.score).toBeCloseTo(INTERNAL_ORIGIN_BONUS, 5);
  });

  it("does not let the internal bonus float a poor match above a good one", () => {
    const [first] = rankResults(
      [
        makeResult({
          id: "internal-wrong-country",
          origin: "INTERNAL",
          source: internalSource,
          capacity: { guests: 2, cabins: null, beds: null },
          location: { country: "Norway", region: null, city: null, marina: null, latitude: null, longitude: null },
        }),
        makeResult({
          id: "external-right-country",
          origin: "EXTERNAL",
          source: externalSource,
          capacity: { guests: 6, cabins: 3, beds: null },
          location: { country: "Greece", region: null, city: null, marina: null, latitude: null, longitude: null },
        }),
      ],
      criteria({ location: { country: "Greece" }, capacity: { persons: 6 } }),
    );

    expect(first.id).toBe("external-right-country");
  });

  it("sorts deterministically when scores tie, so repeated searches do not reshuffle", () => {
    const build = () => [
      makeResult({ id: "bbb", name: "B" }),
      makeResult({ id: "aaa", name: "A" }),
    ];
    const first = rankResults(build(), criteria({})).map((result) => result.id);
    const second = rankResults(build(), criteria({})).map((result) => result.id);
    expect(first).toEqual(second);
  });
});
