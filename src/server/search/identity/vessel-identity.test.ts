import { describe, expect, it } from "vitest";
import { longestNameToken } from "./vessel-identity";

describe("longestNameToken", () => {
  it("picks the most distinguishing word, not the first one", () => {
    expect(longestNameToken("Bavaria Cruiser 36")).toBe("bavaria");
  });

  it("normalizes case and diacritics the same way the rest of the matching pipeline does", () => {
    expect(longestNameToken("Jeanneau Sun Odyssey")).toBe("jeanneau");
  });

  it("skips tokens shorter than the minimum blocking length", () => {
    // "36" and "de" are both too short to block on usefully; "azimut" is what should come back.
    expect(longestNameToken("36 de Azimut")).toBe("azimut");
  });

  it("returns null for a name with nothing long enough to block on", () => {
    expect(longestNameToken("36 44")).toBeNull();
  });

  it("returns null for a null name", () => {
    expect(longestNameToken(null)).toBeNull();
  });
});
