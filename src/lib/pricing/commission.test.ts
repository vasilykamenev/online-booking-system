import { describe, expect, it } from "vitest";
import { calculatePlatformFee, DEFAULT_PLATFORM_COMMISSION_RATE } from "./commission";

describe("calculatePlatformFee", () => {
  it("applies the default rate when none is given", () => {
    expect(calculatePlatformFee(10000)).toBe(Math.round(10000 * DEFAULT_PLATFORM_COMMISSION_RATE));
  });

  it("applies an admin-configured rate", () => {
    expect(calculatePlatformFee(10000, 0.2)).toBe(2000);
  });

  it("rounds to the nearest minor unit", () => {
    expect(calculatePlatformFee(999, 0.125)).toBe(125);
  });

  it("returns 0 for a 0% rate", () => {
    expect(calculatePlatformFee(10000, 0)).toBe(0);
  });
});
