import { describe, expect, it } from "vitest";
import { sourceCovers, type SourceCoverageRow } from "@/server/search/coverage";
import { emptyCriteria, type SearchCriteria } from "@/lib/search/request";

function withLocation(location: Partial<NonNullable<SearchCriteria["location"]>>): SearchCriteria {
  return {
    ...emptyCriteria,
    location: {
      country: null,
      region: null,
      city: null,
      marina: null,
      latitude: null,
      longitude: null,
      ...location,
    },
  };
}

const row = (overrides: Partial<SourceCoverageRow>): SourceCoverageRow => ({
  worldwide: false,
  country: null,
  region: null,
  destination: null,
  latitude: null,
  longitude: null,
  radiusKm: null,
  ...overrides,
});

describe("sourceCovers", () => {
  it("never excludes a source with no coverage rows configured yet", () => {
    expect(sourceCovers([], withLocation({ country: "Greece" }))).toBe(true);
  });

  it("always includes a source marked worldwide", () => {
    expect(sourceCovers([row({ worldwide: true })], withLocation({ country: "Greece" }))).toBe(true);
  });

  it("never excludes a source when the request states no location", () => {
    expect(sourceCovers([row({ country: "Croatia" })], emptyCriteria)).toBe(true);
  });

  it("excludes a source whose coverage names a different country than the request", () => {
    expect(sourceCovers([row({ country: "Croatia" })], withLocation({ country: "Greece" }))).toBe(false);
  });

  it("includes a source when one of several coverage rows matches", () => {
    const coverage = [row({ country: "Croatia" }), row({ country: "Greece" })];
    expect(sourceCovers(coverage, withLocation({ country: "Greece" }))).toBe(true);
  });

  it("matches case- and diacritic-insensitively, same as the rest of the pipeline", () => {
    expect(sourceCovers([row({ country: "GRÈECE" })], withLocation({ country: "greece" }))).toBe(true);
  });

  it("matches a destination row against either city or marina", () => {
    expect(sourceCovers([row({ destination: "Split" })], withLocation({ city: "Split" }))).toBe(true);
    expect(sourceCovers([row({ destination: "Split" })], withLocation({ marina: "Split" }))).toBe(true);
  });

  it("includes a source whose geo-circle contains the request's resolved center", () => {
    const coverage = [row({ latitude: 43.5, longitude: 16.44, radiusKm: 150 })];
    // Dubrovnik, ~164km down the coast from Split — inside a 150km-radius circle only once the
    // request's own searchRadiusKm is added on top.
    const request: SearchCriteria = {
      ...withLocation({ latitude: 42.65, longitude: 18.09 }),
      searchRadiusKm: 50,
    };
    expect(sourceCovers(coverage, request)).toBe(true);
  });

  it("excludes a source whose geo-circle is too far from the request's resolved center", () => {
    const coverage = [row({ latitude: 43.5, longitude: 16.44, radiusKm: 10 })];
    const request = withLocation({ latitude: 37.98, longitude: 23.73 }); // Athens
    expect(sourceCovers(coverage, request)).toBe(false);
  });
});
