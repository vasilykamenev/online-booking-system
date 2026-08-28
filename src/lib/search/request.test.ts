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

  it("drops a vessel type outside the project's own enum, keeping the rest of the list", () => {
    expect(
      searchCriteriaSchema.parse({ vesselTypes: ["CATAMARAN", "submarine"] }).vesselTypes,
    ).toEqual(["CATAMARAN"]);
  });

  it("falls back to an empty list when vesselTypes is not an array", () => {
    expect(searchCriteriaSchema.parse({ vesselTypes: "CATAMARAN" }).vesselTypes).toEqual([]);
  });

  it("falls back to an empty list when amenities is not an array", () => {
    expect(searchCriteriaSchema.parse({ amenities: "wifi" }).amenities).toEqual([]);
  });

  it("keeps amenities and activities independent", () => {
    const criteria = searchCriteriaSchema.parse({ amenities: ["wifi"], activities: ["diving"] });
    expect(criteria.amenities).toEqual(["wifi"]);
    expect(criteria.activities).toEqual(["diving"]);
  });

  it("accepts a length range", () => {
    const criteria = searchCriteriaSchema.parse({ length: { min: 12, max: 14 } });
    expect(criteria.length).toEqual({ min: 12, max: 14 });
  });

  it("rejects a price unit outside the enum", () => {
    expect(searchCriteriaSchema.parse({ priceUnit: "YEAR" }).priceUnit).toBeNull();
  });

  it("accepts a crew type alongside the existing crew booleans", () => {
    const criteria = searchCriteriaSchema.parse({
      crew: { captainRequired: true, crewType: "SKIPPERED" },
    });
    expect(criteria.crew).toEqual({ captainRequired: true, crewRequired: null, crewType: "SKIPPERED" });
  });

  it("degrades an out-of-range coordinate to null rather than rejecting the whole location", () => {
    expect(searchCriteriaSchema.parse({ searchRadiusKm: -5 }).searchRadiusKm).toBeNull();
    const criteria = searchCriteriaSchema.parse({ location: { latitude: 999, longitude: 16 } });
    expect(criteria.location?.latitude).toBeNull();
    expect(criteria.location?.longitude).toBe(16);
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

  it("emits one chip per requested amenity", () => {
    const chips = criteriaToChips(searchCriteriaSchema.parse({ amenities: ["wifi", "diving"] }));
    expect(chips.map((chip) => chip.path)).toEqual(["amenities.wifi", "amenities.diving"]);
  });

  it("emits one chip per vessel type", () => {
    const chips = criteriaToChips(
      searchCriteriaSchema.parse({ vesselTypes: ["CATAMARAN", "TRIMARAN"] }),
    );
    expect(chips.map((chip) => chip.path)).toEqual(["vesselTypes.CATAMARAN", "vesselTypes.TRIMARAN"]);
    expect(chips.every((chip) => chip.labelKey === "vesselType")).toBe(true);
  });

  it("emits a chip for the search radius", () => {
    const chips = criteriaToChips(searchCriteriaSchema.parse({ searchRadiusKm: 50 }));
    expect(chips.map((chip) => chip.path)).toEqual(["searchRadiusKm"]);
  });

  it("emits chips for a length range", () => {
    const chips = criteriaToChips(searchCriteriaSchema.parse({ length: { min: 12, max: 14 } }));
    expect(chips.map((chip) => chip.path)).toEqual(["length.min", "length.max"]);
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

  it("clears a bare top-level scalar field", () => {
    const criteria = searchCriteriaSchema.parse({ searchRadiusKm: 50 });
    expect(removeCriterion(criteria, "searchRadiusKm").searchRadiusKm).toBeNull();
  });

  it("removes one vessel type and leaves the others", () => {
    const criteria = searchCriteriaSchema.parse({ vesselTypes: ["CATAMARAN", "TRIMARAN"] });
    expect(removeCriterion(criteria, "vesselTypes.CATAMARAN").vesselTypes).toEqual(["TRIMARAN"]);
  });

  it("removes one amenity and leaves the others", () => {
    const criteria = searchCriteriaSchema.parse({ amenities: ["wifi", "diving"] });
    expect(removeCriterion(criteria, "amenities.wifi").amenities).toEqual(["diving"]);
  });

  it("removes one activity and leaves the others", () => {
    const criteria = searchCriteriaSchema.parse({ activities: ["diving", "fishing"] });
    expect(removeCriterion(criteria, "activities.diving").activities).toEqual(["fishing"]);
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
      vesselTypes: ["MOTOR_YACHT"],
    });
    const next = ["location.country", "capacity.persons", "vesselTypes.MOTOR_YACHT"].reduce(
      removeCriterion,
      criteria,
    );
    expect(isEmptyCriteria(next)).toBe(true);
  });
});
