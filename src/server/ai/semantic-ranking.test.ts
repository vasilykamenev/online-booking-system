import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyResult, type ResultSource, type VesselSearchResult } from "@/lib/search/offer";
import { searchCriteriaSchema, type SearchCriteria } from "@/lib/search/request";
import { applySemanticRanking, hasSemanticSignal } from "./semantic-ranking";

const source: ResultSource = {
  type: "WEBSITE",
  name: "Example Charter",
  domain: "example.com",
  url: "https://example.com/yacht/123",
  retrievedAt: "2026-08-21T00:00:00.000Z",
};

function makeResult(id: string): VesselSearchResult {
  return emptyResult(id, "EXTERNAL", source);
}

function criteria(partial: Record<string, unknown>): SearchCriteria {
  return searchCriteriaSchema.parse(partial);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("hasSemanticSignal", () => {
  it("is false when neither activities nor keywords were extracted", () => {
    expect(hasSemanticSignal(criteria({}))).toBe(false);
  });

  it("is true when activities carry a soft-preference phrase", () => {
    expect(hasSemanticSignal(criteria({ activities: ["family holiday"] }))).toBe(true);
  });

  it("is true when only keywords carry leftover text", () => {
    expect(hasSemanticSignal(criteria({ keywords: ["тихая"] }))).toBe(true);
  });
});

describe("applySemanticRanking", () => {
  it("returns a single result unchanged without ever consulting the model", async () => {
    const results = [makeResult("r1")];
    const out = await applySemanticRanking(results, "тихая яхта", criteria({ activities: ["quiet"] }));
    expect(out).toEqual(results);
  });

  it("degrades to the deterministic order when no ANTHROPIC_API_KEY is configured", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const results = [makeResult("r1"), makeResult("r2"), makeResult("r3")];
    const out = await applySemanticRanking(results, "тихая семейная яхта", criteria({ activities: ["family holiday"] }));
    expect(out).toEqual(results);
    expect(out.map((r) => r.id)).toEqual(["r1", "r2", "r3"]);
  });
});
