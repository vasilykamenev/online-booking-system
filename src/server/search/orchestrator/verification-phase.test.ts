import { describe, expect, it, vi } from "vitest";
import { emptyResult, type ResultSource, type VesselSearchResult } from "@/lib/search/offer";
import { emptyCriteria, type SearchCriteria } from "@/lib/search/request";
import type { AdapterContext, AvailabilityResult, VesselSourceAdapter } from "@/server/search/adapters/adapter";

/**
 * Э8's own explicit ask (docs/AI_Federated_Search_Migration_Plan_v1.md §6): "ошибка одного сайта не
 * ломает поиск" (Арх §23) — already true structurally (each worker in `mapWithConcurrency` catches
 * its own failure), but not yet covered by a regression test since `global-search-service.ts` was
 * replaced by the Э6 orchestrator. This file is that regression test, plus coverage for the circuit
 * breaker gate this stage adds.
 *
 * `resilience/source-health.ts` and `resilience/rate-limiter.ts` both talk to Postgres — mocked out
 * here the same way `adapters/adapter-registry.test.ts` mocks `source-registry.ts`'s
 * `listEnabledSources`, so this file tests `runVerificationPhase`'s own logic, not Supabase.
 */

const { isSourceCallAllowed, recordSourceFailure, recordSourceSuccess } = vi.hoisted(() => ({
  isSourceCallAllowed: vi.fn(async () => true),
  recordSourceFailure: vi.fn(async () => {}),
  recordSourceSuccess: vi.fn(async () => {}),
}));
vi.mock("@/server/search/resilience/source-health", () => ({
  isSourceCallAllowed,
  recordSourceFailure,
  recordSourceSuccess,
}));

const { throttle } = vi.hoisted(() => ({ throttle: vi.fn(async () => {}) }));
vi.mock("@/server/search/resilience/rate-limiter", () => ({ throttle }));

const { runVerificationPhase } = await import("@/server/search/orchestrator/verification-phase");

const SOURCE: ResultSource = {
  type: "WEBSITE",
  name: "Charter Co",
  domain: "charter.example",
  url: "https://charter.example/listing/1",
  retrievedAt: "2026-08-29T00:00:00.000Z",
};

function externalResult(id: string, sourceId: string, externalId: string): VesselSearchResult {
  return {
    ...emptyResult(id, "EXTERNAL", { ...SOURCE, url: `https://charter.example/${externalId}` }),
    sourceId,
    externalId,
    indexedAt: "2026-08-29T00:00:00.000Z",
  };
}

function fakeAdapter(sourceId: string, checkAvailability: VesselSourceAdapter["checkAvailability"]): VesselSourceAdapter {
  return {
    sourceId,
    supports: () => true,
    search: async () => ({ results: [], stats: { sourcesVisited: 0, pagesVisited: 0, pagesRejected: 0, offersExtracted: 0, aiCalls: 0, pagesServedFromIndex: 0, pagesRevalidatedUnchanged: 0 }, errors: [] }),
    getDetails: async () => null,
    checkAvailability,
    getContactCapability: () => "REDIRECT_ONLY",
  };
}

const DATED_CRITERIA: SearchCriteria = { ...emptyCriteria, date: { from: "2026-09-01", to: "2026-09-10", month: null, year: null, flexible: null } };

describe("runVerificationPhase — one broken source must not sink the pass", () => {
  it("keeps verifying/returning every other result when one adapter's checkAvailability rejects", async () => {
    const broken = externalResult("r1", "broken-source", "listing-1");
    const healthy = externalResult("r2", "healthy-source", "listing-2");

    const adaptersById = new Map<string, VesselSourceAdapter>([
      ["broken-source", fakeAdapter("broken-source", async () => { throw new Error("site is down"); })],
      ["healthy-source", fakeAdapter("healthy-source", async (): Promise<AvailabilityResult> => ({ status: "LIKELY_AVAILABLE", confidence: "HIGH" }))],
    ]);

    const result = await runVerificationPhase([broken, healthy], DATED_CRITERIA, adaptersById, {
      locale: "en",
      sourceReliability: {},
    });

    expect(result.results.map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(result.liveVerifications).toBe(2);
    expect(result.verificationFailures).toBe(1);
    // The broken one degrades to freshness-only inference rather than vanishing from the response.
    expect(result.results.find((r) => r.id === "r1")?.availabilityStatus).toBe("LIKELY_AVAILABLE");
    expect(result.results.find((r) => r.id === "r2")?.availabilityStatus).toBe("LIKELY_AVAILABLE");
  });

  it("drops a result whose live check just confirmed UNAVAILABLE, without affecting the others", async () => {
    const gone = externalResult("r1", "source-a", "listing-1");
    const available = externalResult("r2", "source-a", "listing-2");

    const adapter = fakeAdapter("source-a", async (externalId): Promise<AvailabilityResult> =>
      externalId === "listing-1" ? { status: "UNAVAILABLE", confidence: "HIGH" } : { status: "LIKELY_AVAILABLE", confidence: "HIGH" },
    );

    const result = await runVerificationPhase([gone, available], DATED_CRITERIA, new Map([["source-a", adapter]]), {
      locale: "en",
      sourceReliability: {},
    });

    expect(result.results.map((r) => r.id)).toEqual(["r2"]);
  });
});

describe("runVerificationPhase — circuit breaker", () => {
  it("skips the live call outright when the source's breaker is open, without counting it as a failure", async () => {
    isSourceCallAllowed.mockResolvedValueOnce(false);
    const checkAvailability = vi.fn(async (): Promise<AvailabilityResult> => ({ status: "LIKELY_AVAILABLE", confidence: "HIGH" }));
    const result = await runVerificationPhase(
      [externalResult("r1", "open-source", "listing-1")],
      DATED_CRITERIA,
      new Map([["open-source", fakeAdapter("open-source", checkAvailability)]]),
      { locale: "en", sourceReliability: {} },
    );

    expect(checkAvailability).not.toHaveBeenCalled();
    expect(result.liveVerifications).toBe(0);
    expect(result.verificationFailures).toBe(0);
    expect(result.circuitBreakerSkips).toBe(1);
  });
});

describe("runVerificationPhase — no date window", () => {
  it("attempts no live calls at all, but still derives freshness-based availability", async () => {
    const result = await runVerificationPhase(
      [externalResult("r1", "source-a", "listing-1")],
      emptyCriteria,
      new Map([["source-a", fakeAdapter("source-a", vi.fn())]]),
      { locale: "en", sourceReliability: {} },
    );

    expect(result.liveVerifications).toBe(0);
    expect(result.results[0].availabilityStatus).toBe("LIKELY_AVAILABLE");
  });
});
