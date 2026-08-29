import { afterEach, describe, expect, it, vi } from "vitest";
import type { DuplicateComparable } from "@/lib/search/dedupe";
import { arbitrateDuplicate } from "./duplicate-arbitration";

const a: DuplicateComparable = {
  name: "Sun Odyssey 440",
  year: 2019,
  lengthMeters: 13.4,
  manufacturer: "Jeanneau",
  model: "440",
  location: { city: "Split", marina: null },
  images: [],
};

const b: DuplicateComparable = {
  name: "Jeanneau SO 440",
  year: 2018,
  lengthMeters: 13.4,
  manufacturer: "Jeanneau",
  model: "440",
  location: { city: "Split", marina: null },
  images: [],
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("arbitrateDuplicate", () => {
  it("defaults to false (never merge) when no ANTHROPIC_API_KEY is configured", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const decision = await arbitrateDuplicate(a, b, { score: 0.7, confident: false, signals: { name: 0.7 } });
    expect(decision).toBe(false);
  });
});
