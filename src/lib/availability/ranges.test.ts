import { describe, expect, it } from "vitest";
import { isRangeAvailable, rangesOverlap } from "./ranges";

describe("rangesOverlap", () => {
  it("detects overlapping ranges", () => {
    expect(
      rangesOverlap({ start: "2026-08-01", end: "2026-08-10" }, { start: "2026-08-05", end: "2026-08-08" }),
    ).toBe(true);
  });

  it("treats back-to-back ranges as non-overlapping (end is exclusive)", () => {
    expect(
      rangesOverlap({ start: "2026-08-01", end: "2026-08-05" }, { start: "2026-08-05", end: "2026-08-10" }),
    ).toBe(false);
  });

  it("detects disjoint ranges as non-overlapping", () => {
    expect(
      rangesOverlap({ start: "2026-08-01", end: "2026-08-05" }, { start: "2026-08-10", end: "2026-08-15" }),
    ).toBe(false);
  });
});

describe("isRangeAvailable", () => {
  it("is available when no ranges are blocked", () => {
    expect(isRangeAvailable({ start: "2026-08-01", end: "2026-08-05" }, [])).toBe(true);
  });

  it("is unavailable when it overlaps any blocked range", () => {
    const blocked = [
      { start: "2026-07-01", end: "2026-07-10" },
      { start: "2026-08-03", end: "2026-08-06" },
    ];
    expect(isRangeAvailable({ start: "2026-08-01", end: "2026-08-05" }, blocked)).toBe(false);
  });

  it("is available when adjacent but not overlapping", () => {
    const blocked = [{ start: "2026-08-05", end: "2026-08-10" }];
    expect(isRangeAvailable({ start: "2026-08-01", end: "2026-08-05" }, blocked)).toBe(true);
  });
});
