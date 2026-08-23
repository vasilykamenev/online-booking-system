import { describe, expect, it } from "vitest";
import { selectGenericCandidates } from "./select-candidates";

describe("selectGenericCandidates", () => {
  it("returns everything when there are fewer URLs than the limit", () => {
    const urls = ["a", "b", "c"];
    expect(selectGenericCandidates(urls, 10)).toEqual(urls);
  });

  it("returns everything when the count matches exactly", () => {
    const urls = ["a", "b", "c"];
    expect(selectGenericCandidates(urls, 3)).toEqual(urls);
  });

  it("spreads the selection evenly rather than taking the first N", () => {
    const urls = Array.from({ length: 10 }, (_, i) => `url-${i}`);
    // step = 10/5 = 2 -> indices 0, 2, 4, 6, 8
    expect(selectGenericCandidates(urls, 5)).toEqual(["url-0", "url-2", "url-4", "url-6", "url-8"]);
  });

  it("returns an empty array for a non-positive limit", () => {
    expect(selectGenericCandidates(["a", "b"], 0)).toEqual([]);
    expect(selectGenericCandidates(["a", "b"], -1)).toEqual([]);
  });

  it("returns an empty array for an empty input", () => {
    expect(selectGenericCandidates([], 5)).toEqual([]);
  });

  it("never returns more than the limit even with an uneven ratio", () => {
    const urls = Array.from({ length: 17 }, (_, i) => `url-${i}`);
    expect(selectGenericCandidates(urls, 4)).toHaveLength(4);
  });
});
