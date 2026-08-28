import { describe, expect, it } from "vitest";
import { searchCriteriaSchema } from "@/lib/search/criteria";
import { KNOWN_CITY_SLUGS, matchingCitySlugs, selectCandidates } from "./select-candidates";
import type { BrilionsSitemapEntry } from "./sitemap";

function entry(slug: string, citySlugGuess: string): BrilionsSitemapEntry {
  return {
    slug,
    citySlugGuess,
    urlRu: `https://brilions.com/yacht/${slug}/`,
    urlEn: `https://brilions.com/en/yacht/${slug}/`,
  };
}

describe("matchingCitySlugs", () => {
  it("matches a named city", () => {
    const criteria = searchCriteriaSchema.parse({ location: { city: "Bodrum" } });
    expect(matchingCitySlugs(criteria)).toEqual(new Set(["bodrum"]));
  });

  it("matches every city in a named country", () => {
    const criteria = searchCriteriaSchema.parse({ location: { country: "UAE" } });
    expect(matchingCitySlugs(criteria)).toEqual(new Set(["dubai", "abu"]));
  });

  // The reported bug: "yacht for rent on next month Turkey Antalya" returned every Turkish city,
  // not just Antalya, because the bare "Turkey" term widened the match back out to the whole
  // country even though "Antalya" had already named a specific, known city.
  it("narrows to the named city even when its country is also given, not just the city alone", () => {
    const criteria = searchCriteriaSchema.parse({ location: { city: "Antalya", country: "Turkey" } });
    expect(matchingCitySlugs(criteria)).toEqual(new Set(["antalya"]));
  });

  it("still widens to the whole country when only the country is named, no specific city", () => {
    const criteria = searchCriteriaSchema.parse({ location: { country: "Turkey" } });
    expect(matchingCitySlugs(criteria)).toEqual(
      new Set(["bodrum", "fethiye", "antalya", "marmaris", "gocek", "kemer", "stambul", "alanya", "kas", "izmir"]),
    );
  });

  it("returns an empty set for a location this source doesn't cover — not a skip", () => {
    const criteria = searchCriteriaSchema.parse({ location: { city: "Split" } });
    expect(matchingCitySlugs(criteria)).toEqual(new Set());
  });

  it("skips (null) a query with no location and nothing else to filter on", () => {
    expect(matchingCitySlugs(searchCriteriaSchema.parse({}))).toBeNull();
  });

  // The bug this covers: "моторные яхты" has a vessel type but no city, and used to be skipped
  // outright, so this source never contributed to a query like that.
  it("falls back to every known city for a location-less query naming a vessel type", () => {
    const criteria = searchCriteriaSchema.parse({ vesselTypes: ["MOTOR_YACHT"] });
    expect(matchingCitySlugs(criteria)).toEqual(KNOWN_CITY_SLUGS);
  });

  it("falls back to every known city for a location-less query naming a guest count", () => {
    const criteria = searchCriteriaSchema.parse({ capacity: { persons: 6 } });
    expect(matchingCitySlugs(criteria)).toEqual(KNOWN_CITY_SLUGS);
  });
});

describe("selectCandidates", () => {
  it("takes every matched entry when under the limit", () => {
    const entries = [entry("bodrum-a", "bodrum"), entry("dubai-a", "dubai")];
    const picked = selectCandidates(entries, new Set(["bodrum", "dubai"]), 10);
    expect(picked.map((e) => e.slug)).toEqual(["bodrum-a", "dubai-a"]);
  });

  it("excludes entries from unmatched cities", () => {
    const entries = [entry("bodrum-a", "bodrum"), entry("split-a", "split")];
    const picked = selectCandidates(entries, new Set(["bodrum"]), 10);
    expect(picked.map((e) => e.slug)).toEqual(["bodrum-a"]);
  });

  // The point of round-robin: a broad match (all known cities, e.g. from the vessel-type fallback
  // above) must not let whichever city sorts first in the sitemap eat the whole fetch budget.
  it("round-robins across matched cities instead of draining one city first", () => {
    const entries = [
      entry("bodrum-1", "bodrum"),
      entry("bodrum-2", "bodrum"),
      entry("bodrum-3", "bodrum"),
      entry("dubai-1", "dubai"),
    ];
    const picked = selectCandidates(entries, new Set(["bodrum", "dubai"]), 2);
    expect(picked.map((e) => e.slug)).toEqual(["bodrum-1", "dubai-1"]);
  });

  it("stops at the limit even with entries left over", () => {
    const entries = [entry("bodrum-1", "bodrum"), entry("bodrum-2", "bodrum"), entry("dubai-1", "dubai")];
    const picked = selectCandidates(entries, new Set(["bodrum", "dubai"]), 2);
    expect(picked).toHaveLength(2);
  });
});
