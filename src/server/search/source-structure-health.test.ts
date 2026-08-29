import { describe, expect, it } from "vitest";
import { MIN_SAMPLE_SIZE, SUCCESS_RATE_THRESHOLD, evaluateStructureHealth } from "./source-structure-health";

describe("evaluateStructureHealth", () => {
  it("never flags below the minimum sample size, however bad the rate looks", () => {
    const verdict = evaluateStructureHealth(MIN_SAMPLE_SIZE - 1, 0);
    expect(verdict.needsReanalysis).toBe(false);
    expect(verdict.successRate).toBe(0);
  });

  it("flags once the sample is large enough and the rate falls below the threshold", () => {
    const sampleSize = MIN_SAMPLE_SIZE + 5;
    const successCount = Math.floor(sampleSize * (SUCCESS_RATE_THRESHOLD - 0.1));
    const verdict = evaluateStructureHealth(sampleSize, successCount);
    expect(verdict.needsReanalysis).toBe(true);
    expect(verdict.successRate).toBeLessThan(SUCCESS_RATE_THRESHOLD);
  });

  it("does not flag a healthy source at or above the threshold", () => {
    const sampleSize = 20;
    const successCount = Math.ceil(sampleSize * SUCCESS_RATE_THRESHOLD);
    const verdict = evaluateStructureHealth(sampleSize, successCount);
    expect(verdict.needsReanalysis).toBe(false);
    expect(verdict.successRate).toBeGreaterThanOrEqual(SUCCESS_RATE_THRESHOLD);
  });

  it("reports a null rate, not a division error, for zero samples", () => {
    const verdict = evaluateStructureHealth(0, 0);
    expect(verdict.successRate).toBeNull();
    expect(verdict.needsReanalysis).toBe(false);
  });

  it("is exactly at-threshold-inclusive: a rate equal to the threshold does not flag", () => {
    const sampleSize = 10;
    const successCount = sampleSize * SUCCESS_RATE_THRESHOLD;
    const verdict = evaluateStructureHealth(sampleSize, successCount);
    expect(verdict.successRate).toBe(SUCCESS_RATE_THRESHOLD);
    expect(verdict.needsReanalysis).toBe(false);
  });
});
