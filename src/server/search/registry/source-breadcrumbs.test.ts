import { describe, expect, it } from "vitest";
import { pickUnambiguousParent, pickUnambiguousUrl } from "./source-breadcrumbs";

describe("pickUnambiguousUrl", () => {
  it("returns null when there are no stored rows (cold start)", () => {
    expect(pickUnambiguousUrl([])).toBeNull();
  });

  it("returns the URL when every row agrees", () => {
    const rows = [{ url: "https://sailica.com/catalog/croatia" }, { url: "https://sailica.com/catalog/croatia" }];
    expect(pickUnambiguousUrl(rows)).toBe("https://sailica.com/catalog/croatia");
  });

  it("returns null rather than guessing when rows disagree on the URL", () => {
    const rows = [
      { url: "https://sailica.com/catalog/croatia" },
      { url: "https://sailica.com/catalog/croatia-old" },
    ];
    expect(pickUnambiguousUrl(rows)).toBeNull();
  });
});

describe("pickUnambiguousParent", () => {
  it("returns null when there are no stored rows", () => {
    expect(pickUnambiguousParent([])).toBeNull();
  });

  it("returns the parent when every row agrees", () => {
    const rows = [{ normalizedParentLabel: "croatia" }, { normalizedParentLabel: "croatia" }];
    expect(pickUnambiguousParent(rows)).toBe("croatia");
  });

  it("returns null rather than guessing when the same city was seen under different parents", () => {
    // The exact scenario the whole design discussion was about: the same city name appearing under
    // two different countries on the same source must never resolve to either one.
    const rows = [{ normalizedParentLabel: "croatia" }, { normalizedParentLabel: "montenegro" }];
    expect(pickUnambiguousParent(rows)).toBeNull();
  });

  it("ignores rows with no parent at all (a trail's own root crumb)", () => {
    const rows = [{ normalizedParentLabel: "" }, { normalizedParentLabel: "croatia" }];
    expect(pickUnambiguousParent(rows)).toBe("croatia");
  });

  it("returns null when every row has no parent", () => {
    expect(pickUnambiguousParent([{ normalizedParentLabel: "" }])).toBeNull();
  });
});
