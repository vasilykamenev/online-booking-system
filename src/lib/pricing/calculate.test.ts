import { describe, expect, it } from "vitest";
import { calculateBookingPrice, priceForNight, type PricingRule } from "./calculate";

describe("priceForNight", () => {
  it("falls back to the base price when no rule covers the night", () => {
    expect(priceForNight("2026-08-10", 20000, [])).toBe(20000);
  });

  it("applies a rule that covers the night", () => {
    const rules: PricingRule[] = [
      { startDate: "2026-08-01", endDate: "2026-08-15", priceMinor: 30000, priority: 1 },
    ];
    expect(priceForNight("2026-08-10", 20000, rules)).toBe(30000);
  });

  it("treats the rule end date as exclusive", () => {
    const rules: PricingRule[] = [
      { startDate: "2026-08-01", endDate: "2026-08-10", priceMinor: 30000, priority: 1 },
    ];
    expect(priceForNight("2026-08-10", 20000, rules)).toBe(20000);
  });

  it("picks the higher-priority rule when ranges overlap", () => {
    const rules: PricingRule[] = [
      { startDate: "2026-08-01", endDate: "2026-08-31", priceMinor: 25000, priority: 1 },
      { startDate: "2026-08-05", endDate: "2026-08-10", priceMinor: 40000, priority: 5 },
    ];
    expect(priceForNight("2026-08-07", 20000, rules)).toBe(40000);
  });

  it("breaks a priority tie with the higher price", () => {
    const rules: PricingRule[] = [
      { startDate: "2026-08-01", endDate: "2026-08-31", priceMinor: 25000, priority: 1 },
      { startDate: "2026-08-05", endDate: "2026-08-10", priceMinor: 35000, priority: 1 },
    ];
    expect(priceForNight("2026-08-07", 20000, rules)).toBe(35000);
  });
});

describe("calculateBookingPrice", () => {
  it("charges nothing for the checkout day itself", () => {
    const breakdown = calculateBookingPrice("2026-08-01", "2026-08-04", 10000, []);
    expect(breakdown.nightsCount).toBe(3);
    expect(breakdown.nights.map((n) => n.date)).toEqual([
      "2026-08-01",
      "2026-08-02",
      "2026-08-03",
    ]);
    expect(breakdown.totalMinor).toBe(30000);
  });

  it("sums per-night prices across a rule boundary", () => {
    const rules: PricingRule[] = [
      { startDate: "2026-08-03", endDate: "2026-08-10", priceMinor: 15000, priority: 1 },
    ];
    const breakdown = calculateBookingPrice("2026-08-01", "2026-08-05", 10000, rules);
    expect(breakdown.nights.map((n) => n.priceMinor)).toEqual([10000, 10000, 15000, 15000]);
    expect(breakdown.totalMinor).toBe(50000);
  });

  it("returns zero nights for an empty range", () => {
    const breakdown = calculateBookingPrice("2026-08-01", "2026-08-01", 10000, []);
    expect(breakdown.nightsCount).toBe(0);
    expect(breakdown.totalMinor).toBe(0);
  });
});
