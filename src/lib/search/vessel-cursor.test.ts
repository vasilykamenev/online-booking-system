import { describe, expect, it } from "vitest";
import {
  buildVesselCursorFilter,
  decodeVesselCursor,
  encodeVesselCursor,
  VESSEL_SORT_CONFIG,
} from "./vessel-cursor";

describe("encodeVesselCursor / decodeVesselCursor", () => {
  it("round-trips a numeric value and an id", () => {
    const cursor = encodeVesselCursor(4.5, "vessel-1");
    expect(decodeVesselCursor(cursor)).toEqual({ value: 4.5, id: "vessel-1" });
  });

  it("returns null for a malformed cursor instead of throwing", () => {
    expect(decodeVesselCursor("not-a-cursor")).toBeNull();
    expect(decodeVesselCursor("4.5:")).toBeNull();
    expect(decodeVesselCursor("")).toBeNull();
  });
});

describe("buildVesselCursorFilter", () => {
  it("uses gt for an ascending sort (price_asc)", () => {
    const filter = buildVesselCursorFilter("price_asc", { value: 1000, id: "v1" });
    expect(filter).toBe("base_price_minor.gt.1000,and(base_price_minor.eq.1000,id.lt.v1)");
  });

  it("uses lt for a descending sort (rating_desc)", () => {
    const filter = buildVesselCursorFilter("rating_desc", { value: 4.5, id: "v1" });
    expect(filter).toBe("rating_avg.lt.4.5,and(rating_avg.eq.4.5,id.lt.v1)");
  });

  it("has a config entry for every sort value", () => {
    const sorts: (keyof typeof VESSEL_SORT_CONFIG)[] = [
      "rating_desc",
      "price_asc",
      "price_desc",
      "length_desc",
    ];
    for (const sort of sorts) {
      expect(VESSEL_SORT_CONFIG[sort]).toBeDefined();
    }
  });
});
