import { describe, expect, it } from "vitest";
import {
  afterFailure,
  afterSuccess,
  isCallAllowed,
  CLOSED_SNAPSHOT,
  type CircuitBreakerPolicy,
  type CircuitSnapshot,
} from "./circuit-breaker";

const POLICY: CircuitBreakerPolicy = { failureThreshold: 3, cooldownMs: 10_000 };
const NOW = Date.parse("2026-08-29T12:00:00.000Z");

describe("afterFailure — from CLOSED", () => {
  it("stays CLOSED below the failure threshold, just counting up", () => {
    const result = afterFailure(CLOSED_SNAPSHOT, POLICY, NOW);
    expect(result).toEqual({ state: "CLOSED", consecutiveFailures: 1, openedAt: null });
  });

  it("trips OPEN exactly at the failure threshold", () => {
    const twoFailures: CircuitSnapshot = { state: "CLOSED", consecutiveFailures: 2, openedAt: null };
    const result = afterFailure(twoFailures, POLICY, NOW);
    expect(result.state).toBe("OPEN");
    expect(result.consecutiveFailures).toBe(3);
    expect(result.openedAt).toBe(new Date(NOW).toISOString());
  });
});

describe("afterFailure — from OPEN or HALF_OPEN", () => {
  it("re-opens immediately from OPEN, restarting the cooldown", () => {
    const open: CircuitSnapshot = { state: "OPEN", consecutiveFailures: 5, openedAt: "2026-08-29T11:00:00.000Z" };
    const result = afterFailure(open, POLICY, NOW);
    expect(result.state).toBe("OPEN");
    expect(result.openedAt).toBe(new Date(NOW).toISOString());
  });

  it("re-opens from a HALF_OPEN trial call that itself failed", () => {
    const halfOpen: CircuitSnapshot = { state: "HALF_OPEN", consecutiveFailures: 3, openedAt: "2026-08-29T11:00:00.000Z" };
    const result = afterFailure(halfOpen, POLICY, NOW);
    expect(result.state).toBe("OPEN");
  });
});

describe("afterSuccess", () => {
  it("fully closes the breaker regardless of prior state", () => {
    expect(afterSuccess()).toEqual(CLOSED_SNAPSHOT);
  });
});

describe("isCallAllowed", () => {
  it("always allows a call while CLOSED", () => {
    expect(isCallAllowed(CLOSED_SNAPSHOT, POLICY, NOW)).toBe(true);
  });

  it("always allows a call while HALF_OPEN — that state IS the trial", () => {
    const halfOpen: CircuitSnapshot = { state: "HALF_OPEN", consecutiveFailures: 3, openedAt: "2026-08-29T11:00:00.000Z" };
    expect(isCallAllowed(halfOpen, POLICY, NOW)).toBe(true);
  });

  it("blocks a call while OPEN and the cooldown hasn't elapsed", () => {
    const open: CircuitSnapshot = { state: "OPEN", consecutiveFailures: 3, openedAt: new Date(NOW - 1_000).toISOString() };
    expect(isCallAllowed(open, POLICY, NOW)).toBe(false);
  });

  it("allows a call once the cooldown has elapsed", () => {
    const open: CircuitSnapshot = {
      state: "OPEN",
      consecutiveFailures: 3,
      openedAt: new Date(NOW - POLICY.cooldownMs).toISOString(),
    };
    expect(isCallAllowed(open, POLICY, NOW)).toBe(true);
  });

  it("fails open for a malformed OPEN snapshot with no openedAt, rather than wedging shut forever", () => {
    const malformed: CircuitSnapshot = { state: "OPEN", consecutiveFailures: 3, openedAt: null };
    expect(isCallAllowed(malformed, POLICY, NOW)).toBe(true);
  });
});
