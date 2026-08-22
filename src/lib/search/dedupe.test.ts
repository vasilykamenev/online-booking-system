import { describe, expect, it } from "vitest";
import { emptyResult, type ResultSource, type VesselSearchResult } from "./result";
import { assessDuplicate, dedupeResults, mergeResults } from "./dedupe";

const internalSource: ResultSource = {
  type: "INTERNAL",
  name: "Meridian",
  domain: null,
  url: "/vessels/adriatic-dream",
  retrievedAt: "2026-08-21T00:00:00.000Z",
};

const charterSource: ResultSource = {
  type: "WEBSITE",
  name: "Example Charter",
  domain: "example.com",
  url: "https://example.com/yacht/123",
  retrievedAt: "2026-08-21T00:00:00.000Z",
};

const otherSource: ResultSource = {
  type: "WEBSITE",
  name: "Another Charter",
  domain: "another.com",
  url: "https://another.com/boats/77",
  retrievedAt: "2026-08-21T00:00:00.000Z",
};

function makeResult(overrides: Partial<VesselSearchResult> & { id: string }): VesselSearchResult {
  const base = emptyResult(overrides.id, overrides.origin ?? "EXTERNAL", overrides.source ?? charterSource);
  return { ...base, ...overrides };
}

describe("assessDuplicate — vetoes", () => {
  it("refuses to merge two listings that disagree on the build year", () => {
    const assessment = assessDuplicate(
      makeResult({ id: "a", name: "Sun Odyssey 440", year: 2019 }),
      makeResult({ id: "b", name: "Sun Odyssey 440", year: 2021, source: otherSource }),
    );
    expect(assessment.confident).toBe(false);
    expect(assessment.vetoedBy).toBe("year");
  });

  it("refuses to merge when lengths differ beyond rounding noise", () => {
    const assessment = assessDuplicate(
      makeResult({ id: "a", name: "Sun Odyssey 440", lengthMeters: 13.4 }),
      makeResult({ id: "b", name: "Sun Odyssey 440", lengthMeters: 18.9, source: otherSource }),
    );
    expect(assessment.vetoedBy).toBe("length");
  });

  it("tolerates small length differences from different rounding conventions", () => {
    const assessment = assessDuplicate(
      makeResult({ id: "a", name: "Sun Odyssey 440", lengthMeters: 13.4 }),
      makeResult({ id: "b", name: "Sun Odyssey 440", lengthMeters: 13.5, source: otherSource }),
    );
    expect(assessment.vetoedBy).toBeUndefined();
  });
});

describe("assessDuplicate — evidence", () => {
  it("does not consider unrelated names a duplicate", () => {
    const assessment = assessDuplicate(
      makeResult({ id: "a", name: "Adriatic Dream" }),
      makeResult({ id: "b", name: "Northern Light", source: otherSource }),
    );
    expect(assessment.confident).toBe(false);
  });

  it("merges the same vessel listed with a manufacturer prefix on one site", () => {
    const assessment = assessDuplicate(
      makeResult({
        id: "a",
        name: "Sun Odyssey 440",
        manufacturer: "Jeanneau",
        year: 2019,
        lengthMeters: 13.4,
        location: { country: "Croatia", region: null, city: "Split", marina: null, latitude: null, longitude: null },
      }),
      makeResult({
        id: "b",
        name: "Sun Odyssey 440",
        manufacturer: "Jeanneau",
        year: 2019,
        lengthMeters: 13.4,
        location: { country: "Croatia", region: null, city: "Split", marina: null, latitude: null, longitude: null },
        source: otherSource,
      }),
    );
    expect(assessment.confident).toBe(true);
  });

  it("treats a shared image URL as strong evidence even without a strong name match", () => {
    const image = { url: "https://cdn.example.com/photo-1.jpg", alt: null };
    const assessment = assessDuplicate(
      makeResult({ id: "a", name: "Adriatic Dream", images: [image] }),
      makeResult({ id: "b", name: "Yacht #4412", images: [image], source: otherSource }),
    );
    expect(assessment.signals.image).toBe(1);
    expect(assessment.score).toBeGreaterThan(0);
  });
});

describe("mergeResults", () => {
  it("keeps the primary's values and only fills its gaps from the duplicate", () => {
    const primary = makeResult({ id: "a", name: "Adriatic Dream", year: null, manufacturer: null });
    const duplicate = makeResult({
      id: "b",
      name: "Adriatic Dream (Jeanneau)",
      year: 2019,
      manufacturer: "Jeanneau",
      source: otherSource,
    });

    const merged = mergeResults(primary, duplicate);
    expect(merged.name).toBe("Adriatic Dream");
    expect(merged.year).toBe(2019);
    expect(merged.manufacturer).toBe("Jeanneau");
  });

  it("never drops a source link when collapsing duplicates (spec §14)", () => {
    const merged = mergeResults(
      makeResult({ id: "a", name: "Adriatic Dream", source: charterSource }),
      makeResult({ id: "b", name: "Adriatic Dream", source: otherSource }),
    );
    expect(merged.source.url).toBe(charterSource.url);
    expect(merged.alternateSources.map((source) => source.url)).toContain(otherSource.url);
  });

  it("unions images and features rather than replacing them", () => {
    const merged = mergeResults(
      makeResult({ id: "a", name: "X", features: ["wifi"], images: [{ url: "a.jpg", alt: null }] }),
      makeResult({ id: "b", name: "X", features: ["diving"], images: [{ url: "b.jpg", alt: null }], source: otherSource }),
    );
    expect(merged.features).toEqual(expect.arrayContaining(["wifi", "diving"]));
    expect(merged.images).toHaveLength(2);
  });
});

describe("dedupeResults", () => {
  const sharedFacts = {
    name: "Sun Odyssey 440",
    manufacturer: "Jeanneau",
    year: 2019,
    lengthMeters: 13.4,
    location: { country: "Croatia", region: null, city: "Split", marina: null, latitude: null, longitude: null },
  };

  it("collapses the same vessel found in three places into one row", () => {
    const deduped = dedupeResults([
      makeResult({ id: "a", ...sharedFacts, source: charterSource }),
      makeResult({ id: "b", ...sharedFacts, source: otherSource }),
      makeResult({ id: "c", ...sharedFacts, origin: "INTERNAL", source: internalSource }),
    ]);
    expect(deduped).toHaveLength(1);
  });

  it("keeps the internal listing as the surviving row so the user can still book it", () => {
    const [survivor] = dedupeResults([
      makeResult({ id: "external", ...sharedFacts, source: charterSource }),
      makeResult({
        id: "internal",
        ...sharedFacts,
        origin: "INTERNAL",
        source: internalSource,
        internalVesselId: "vessel-1",
        slug: "sun-odyssey-440",
      }),
    ]);

    expect(survivor.origin).toBe("INTERNAL");
    expect(survivor.internalVesselId).toBe("vessel-1");
    expect(survivor.alternateSources.map((source) => source.url)).toContain(charterSource.url);
  });

  it("leaves genuinely different vessels alone", () => {
    const deduped = dedupeResults([
      makeResult({ id: "a", name: "Adriatic Dream", year: 2019 }),
      makeResult({ id: "b", name: "Northern Light", year: 2015, source: otherSource }),
    ]);
    expect(deduped).toHaveLength(2);
  });
});
