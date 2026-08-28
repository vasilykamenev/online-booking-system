import { describe, expect, it } from "vitest";
import {
  criteriaToChips,
  emptyCriteria,
  isEmptyCriteria,
  removeCriterion,
  searchCriteriaSchema,
} from "./criteria";

describe("searchCriteriaSchema — tolerating untrusted model output", () => {
  it("parses an empty object into all-null criteria", () => {
    expect(isEmptyCriteria(searchCriteriaSchema.parse({}))).toBe(true);
  });

  it("converts a stated price into minor units", () => {
    const criteria = searchCriteriaSchema.parse({ price: { max: 5000, currency: "eur" } });
    expect(criteria.price?.maxMinor).toBe(500_000);
    expect(criteria.price?.currency).toBe("EUR");
  });

  it("degrades a malformed field to null instead of rejecting the whole interpretation", () => {
    const criteria = searchCriteriaSchema.parse({
      capacity: { persons: "not a number" },
      location: { country: "Greece" },
    });
    expect(criteria.capacity?.persons).toBeNull();
    // The salvageable half of the interpretation survives.
    expect(criteria.location?.country).toBe("Greece");
  });

  it("drops an out-of-range month rather than clamping it to a real one", () => {
    expect(searchCriteriaSchema.parse({ date: { month: 33 } }).date?.month).toBeNull();
  });

  it("rejects a vessel type outside the project's own enum", () => {
    expect(searchCriteriaSchema.parse({ vesselType: "submarine" }).vesselType).toBeNull();
  });

  it("falls back to an empty list when features is not an array", () => {
    expect(searchCriteriaSchema.parse({ features: "wifi" }).features).toEqual([]);
  });
});

describe("criteriaToChips", () => {
  it("emits a chip only for criteria that were actually extracted", () => {
    const chips = criteriaToChips(
      searchCriteriaSchema.parse({ location: { country: "Greece" }, capacity: { persons: 6 } }),
    );
    expect(chips.map((chip) => chip.path)).toEqual(["location.country", "capacity.persons"]);
  });

  it("shows a month chip only when no exact window was resolved", () => {
    const fuzzy = criteriaToChips(searchCriteriaSchema.parse({ date: { month: 9 } }));
    expect(fuzzy.map((chip) => chip.path)).toContain("date.month");

    const exact = criteriaToChips(
      searchCriteriaSchema.parse({ date: { from: "2026-09-01", to: "2026-09-08", month: 9 } }),
    );
    expect(exact.map((chip) => chip.path)).not.toContain("date.month");
  });

  it("emits one chip per requested feature", () => {
    const chips = criteriaToChips(searchCriteriaSchema.parse({ features: ["wifi", "diving"] }));
    expect(chips.map((chip) => chip.path)).toEqual(["features.wifi", "features.diving"]);
  });

  it("carries the duration's unit, so '2 weeks' is never rendered as '2 days'", () => {
    const chips = criteriaToChips(
      searchCriteriaSchema.parse({ duration: { value: 2, unit: "WEEK" } }),
    );
    const duration = chips.find((chip) => chip.labelKey === "duration");
    expect(duration).toMatchObject({ value: 2, unit: "WEEK" });
  });

  it("leaves the unit undefined rather than defaulting to days when none was stated", () => {
    const chips = criteriaToChips(searchCriteriaSchema.parse({ duration: { value: 3 } }));
    expect(chips.find((chip) => chip.labelKey === "duration")?.unit).toBeUndefined();
  });

  it("shows a year chip so an inferred year is visible and removable", () => {
    // Interpreters resolve "next March" to a concrete year. A criterion that filters but cannot be
    // seen or dismissed is worse than one that was never extracted.
    const chips = criteriaToChips(searchCriteriaSchema.parse({ date: { month: 3, year: 2027 } }));
    expect(chips.map((chip) => chip.path)).toContain("date.year");
  });

  it("hides the year chip when an exact window already states it", () => {
    const chips = criteriaToChips(
      searchCriteriaSchema.parse({ date: { from: "2027-03-01", to: "2027-03-14", year: 2027 } }),
    );
    expect(chips.map((chip) => chip.path)).not.toContain("date.year");
  });

  it("produces nothing for empty criteria", () => {
    expect(criteriaToChips(emptyCriteria)).toEqual([]);
  });
});

describe("removeCriterion", () => {
  it("clears a single nested field", () => {
    const criteria = searchCriteriaSchema.parse({ capacity: { persons: 6, cabins: 3 } });
    const next = removeCriterion(criteria, "capacity.persons");
    expect(next.capacity?.persons).toBeNull();
    expect(next.capacity?.cabins).toBe(3);
  });

  it("collapses a group to null once its last field is removed", () => {
    const criteria = searchCriteriaSchema.parse({ capacity: { persons: 6 } });
    expect(removeCriterion(criteria, "capacity.persons").capacity).toBeNull();
  });

  it("clears a top-level field", () => {
    const criteria = searchCriteriaSchema.parse({ vesselType: "CATAMARAN" });
    expect(removeCriterion(criteria, "vesselType").vesselType).toBeNull();
  });

  it("removes one feature and leaves the others", () => {
    const criteria = searchCriteriaSchema.parse({ features: ["wifi", "diving"] });
    expect(removeCriterion(criteria, "features.wifi").features).toEqual(["diving"]);
  });

  it("ignores an unknown path instead of throwing — paths round-trip through the URL", () => {
    const criteria = searchCriteriaSchema.parse({ capacity: { persons: 6 } });
    expect(removeCriterion(criteria, "nonsense.path").capacity?.persons).toBe(6);
    expect(removeCriterion(criteria, "__proto__.polluted").capacity?.persons).toBe(6);
  });

  it("does not mutate the criteria it was given", () => {
    const criteria = searchCriteriaSchema.parse({ capacity: { persons: 6 } });
    removeCriterion(criteria, "capacity.persons");
    expect(criteria.capacity?.persons).toBe(6);
  });

  it("applies repeatedly, as a chain of chip dismissals does", () => {
    const criteria = searchCriteriaSchema.parse({
      location: { country: "Greece" },
      capacity: { persons: 6 },
      vesselType: "MOTOR_YACHT",
    });
    const next = ["location.country", "capacity.persons", "vesselType"].reduce(removeCriterion, criteria);
    expect(isEmptyCriteria(next)).toBe(true);
  });
});
