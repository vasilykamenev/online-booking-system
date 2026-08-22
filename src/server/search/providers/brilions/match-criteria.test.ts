import { describe, expect, it } from "vitest";
import { matchesKnownCriteria } from "./match-criteria";
import { emptyResult, type ResultSource, type VesselSearchResult } from "@/lib/search/result";
import { searchCriteriaSchema } from "@/lib/search/criteria";

const source: ResultSource = {
  type: "WEBSITE",
  name: "Brilions",
  domain: "brilions.com",
  url: "https://brilions.com/yacht/antalya-savas/",
  retrievedAt: "2026-08-21T00:00:00.000Z",
};

function fishingBoat(overrides: Partial<VesselSearchResult> = {}): VesselSearchResult {
  return {
    ...emptyResult("brilions:antalya-savas", "EXTERNAL", source),
    vesselType: null,
    vesselTypeRaw: "Яхта для рыбалки",
    capacity: { guests: 2, cabins: null, beds: null },
    ...overrides,
  };
}

describe("matchesKnownCriteria — vessel type", () => {
  it("excludes a result whose known type mismatches the requested one", () => {
    const catamaran = fishingBoat({ vesselType: "catamaran" });
    expect(matchesKnownCriteria(catamaran, searchCriteriaSchema.parse({ vesselType: "yacht" }))).toBe(false);
  });

  it("does not exclude on type when the result's type is unmapped (vesselTypeRaw only)", () => {
    // "Яхта для рыбалки" (fishing charter) never mapped onto our enum, so vesselType is null —
    // there's nothing reliable to compare, so this factor must not filter it out.
    const result = fishingBoat({ vesselType: null });
    expect(matchesKnownCriteria(result, searchCriteriaSchema.parse({ vesselType: "yacht" }))).toBe(true);
  });

  it("keeps a matching type", () => {
    const result = fishingBoat({ vesselType: "yacht" });
    expect(matchesKnownCriteria(result, searchCriteriaSchema.parse({ vesselType: "yacht" }))).toBe(true);
  });

  it("does not filter on type when the query didn't ask for one", () => {
    const result = fishingBoat({ vesselType: "catamaran" });
    expect(matchesKnownCriteria(result, searchCriteriaSchema.parse({}))).toBe(true);
  });
});

describe("matchesKnownCriteria — capacity", () => {
  it("excludes a vessel that cannot fit the requested party (the observed Antalya fishing-boat case)", () => {
    const twoSeater = fishingBoat({ capacity: { guests: 2, cabins: null, beds: null } });
    expect(
      matchesKnownCriteria(twoSeater, searchCriteriaSchema.parse({ capacity: { persons: 6 } })),
    ).toBe(false);
  });

  it("keeps a vessel that fits exactly", () => {
    const sixSeater = fishingBoat({ capacity: { guests: 6, cabins: null, beds: null } });
    expect(
      matchesKnownCriteria(sixSeater, searchCriteriaSchema.parse({ capacity: { persons: 6 } })),
    ).toBe(true);
  });

  it("does not filter on capacity when the page states no guest count", () => {
    const unknown = fishingBoat({ capacity: { guests: null, cabins: null, beds: null } });
    expect(
      matchesKnownCriteria(unknown, searchCriteriaSchema.parse({ capacity: { persons: 6 } })),
    ).toBe(true);
  });
});

describe("matchesKnownCriteria — never filters on price", () => {
  it("keeps a result even when the query has a budget — this source never publishes prices", () => {
    const result = fishingBoat();
    expect(
      matchesKnownCriteria(result, searchCriteriaSchema.parse({ price: { max: 1000, currency: "EUR" } })),
    ).toBe(true);
  });
});
