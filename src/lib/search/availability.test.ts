import { describe, expect, it } from "vitest";
import { deriveAvailability, LIKELY_AVAILABLE_FRESHNESS_MS } from "./availability";

const NOW = Date.parse("2026-08-29T12:00:00.000Z");

describe("deriveAvailability — internal", () => {
  it("is always VERIFIED with no confidence, regardless of any other input", () => {
    expect(
      deriveAvailability({
        origin: "INTERNAL",
        now: NOW,
        indexedAt: null,
        liveVerification: { status: "UNAVAILABLE", confidence: "HIGH" },
        sourceReliability: 0,
      }),
    ).toEqual({ status: "VERIFIED", confidence: null });
  });
});

describe("deriveAvailability — live verification this request", () => {
  it("UNAVAILABLE from the adapter always wins, even over high reliability", () => {
    expect(
      deriveAvailability({
        origin: "EXTERNAL",
        now: NOW,
        indexedAt: new Date(NOW).toISOString(),
        liveVerification: { status: "UNAVAILABLE", confidence: "HIGH" },
        sourceReliability: 1,
      }),
    ).toEqual({ status: "UNAVAILABLE", confidence: "HIGH" });
  });

  it("never claims VERIFIED for an external offer, even when the adapter itself reports it", () => {
    const result = deriveAvailability({
      origin: "EXTERNAL",
      now: NOW,
      indexedAt: null,
      liveVerification: { status: "VERIFIED", confidence: "HIGH" },
      sourceReliability: 1,
    });
    expect(result.status).toBe("LIKELY_AVAILABLE");
  });

  it("upgrades confidence to HIGH for a reliable source's live confirmation", () => {
    expect(
      deriveAvailability({
        origin: "EXTERNAL",
        now: NOW,
        indexedAt: null,
        liveVerification: { status: "LIKELY_AVAILABLE", confidence: null },
        sourceReliability: 0.9,
      }),
    ).toEqual({ status: "LIKELY_AVAILABLE", confidence: "HIGH" });
  });

  it("caps confidence at MEDIUM for a live confirmation from an unreliable/unmeasured source", () => {
    expect(
      deriveAvailability({
        origin: "EXTERNAL",
        now: NOW,
        indexedAt: null,
        liveVerification: { status: "LIKELY_AVAILABLE", confidence: null },
        sourceReliability: null,
      }),
    ).toEqual({ status: "LIKELY_AVAILABLE", confidence: "MEDIUM" });
  });

  it("falls through to freshness when the live check itself came back honestly UNKNOWN", () => {
    const result = deriveAvailability({
      origin: "EXTERNAL",
      now: NOW,
      indexedAt: new Date(NOW).toISOString(),
      liveVerification: { status: "UNKNOWN", confidence: null },
      sourceReliability: 0.9,
    });
    // Falls to the freshness branch (fresh index, reliable source), not to plain UNKNOWN.
    expect(result).toEqual({ status: "LIKELY_AVAILABLE", confidence: "MEDIUM" });
  });
});

describe("deriveAvailability — no live verification, freshness only", () => {
  it("is LIKELY_AVAILABLE for a fresh index row, MEDIUM confidence for a reliable source", () => {
    expect(
      deriveAvailability({
        origin: "EXTERNAL",
        now: NOW,
        indexedAt: new Date(NOW - 60 * 60 * 1000).toISOString(), // 1h old
        liveVerification: null,
        sourceReliability: 0.8,
      }),
    ).toEqual({ status: "LIKELY_AVAILABLE", confidence: "MEDIUM" });
  });

  it("is LIKELY_AVAILABLE with LOW confidence for a fresh row from an unreliable/unmeasured source", () => {
    expect(
      deriveAvailability({
        origin: "EXTERNAL",
        now: NOW,
        indexedAt: new Date(NOW - 60 * 60 * 1000).toISOString(),
        liveVerification: null,
        sourceReliability: null,
      }),
    ).toEqual({ status: "LIKELY_AVAILABLE", confidence: "LOW" });
  });

  it("is exactly at the freshness boundary still LIKELY_AVAILABLE", () => {
    const result = deriveAvailability({
      origin: "EXTERNAL",
      now: NOW,
      indexedAt: new Date(NOW - LIKELY_AVAILABLE_FRESHNESS_MS).toISOString(),
      liveVerification: null,
      sourceReliability: 0.8,
    });
    expect(result.status).toBe("LIKELY_AVAILABLE");
  });

  it("falls back to UNKNOWN once the index row is older than the freshness window", () => {
    expect(
      deriveAvailability({
        origin: "EXTERNAL",
        now: NOW,
        indexedAt: new Date(NOW - LIKELY_AVAILABLE_FRESHNESS_MS - 1).toISOString(),
        liveVerification: null,
        sourceReliability: 1,
      }),
    ).toEqual({ status: "UNKNOWN", confidence: null });
  });

  it("is UNKNOWN with no confidence when there is no index data at all", () => {
    expect(
      deriveAvailability({
        origin: "EXTERNAL",
        now: NOW,
        indexedAt: null,
        liveVerification: null,
        sourceReliability: 1,
      }),
    ).toEqual({ status: "UNKNOWN", confidence: null });
  });

  it("is UNKNOWN for an unparseable indexedAt rather than throwing", () => {
    expect(
      deriveAvailability({
        origin: "EXTERNAL",
        now: NOW,
        indexedAt: "not-a-date",
        liveVerification: null,
        sourceReliability: 1,
      }),
    ).toEqual({ status: "UNKNOWN", confidence: null });
  });
});
