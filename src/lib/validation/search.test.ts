import { describe, expect, it } from "vitest";
import {
  activeFilterChipKeys,
  buildSearchUrl,
  parseSearchParams,
  removeSearchFilterUrl,
  searchParamsSchema,
} from "./search";

describe("searchParamsSchema", () => {
  it("accepts an empty object — no filter is ever required", () => {
    const result = searchParamsSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts any single filter present on its own", () => {
    const cases: Record<string, unknown>[] = [
      { type: "catamaran" },
      { location: "20000000-0000-0000-0000-000000000001" },
      { guests: "4" },
      { priceMin: "500" },
      { priceMax: "2000" },
      { lengthMin: "10" },
      { lengthMax: "20" },
      { cabinsMin: "2" },
      { sort: "price_asc" },
    ];
    for (const input of cases) {
      expect(searchParamsSchema.safeParse(input).success, JSON.stringify(input)).toBe(true);
    }
  });

  it("treats empty-string form values as absent, not zero", () => {
    const result = searchParamsSchema.parse({ guests: "", priceMax: "", dateFrom: "" });
    expect(result.guests).toBeUndefined();
    expect(result.priceMax).toBeUndefined();
    expect(result.dateFrom).toBeUndefined();
  });

  it("allows a lone dateFrom or dateTo — dates only filter once both ends are present", () => {
    expect(searchParamsSchema.safeParse({ dateFrom: "2026-09-01" }).success).toBe(true);
    expect(searchParamsSchema.safeParse({ dateTo: "2026-09-10" }).success).toBe(true);
  });

  it("rejects dateTo before dateFrom when both are present", () => {
    const result = searchParamsSchema.safeParse({ dateFrom: "2026-09-10", dateTo: "2026-09-01" });
    expect(result.success).toBe(false);
  });

  it("accepts an equal dateFrom/dateTo pair as invalid (half-open range needs to be non-empty)", () => {
    const result = searchParamsSchema.safeParse({ dateFrom: "2026-09-01", dateTo: "2026-09-01" });
    expect(result.success).toBe(false);
  });

  it("rejects priceMax below priceMin, allows priceMax without priceMin", () => {
    expect(searchParamsSchema.safeParse({ priceMin: "2000", priceMax: "500" }).success).toBe(false);
    expect(searchParamsSchema.safeParse({ priceMax: "500" }).success).toBe(true);
  });

  it("rejects lengthMax below lengthMin, allows lengthMin without lengthMax", () => {
    expect(searchParamsSchema.safeParse({ lengthMin: "20", lengthMax: "10" }).success).toBe(false);
    expect(searchParamsSchema.safeParse({ lengthMin: "20" }).success).toBe(true);
  });

  it("accepts every filter present at once", () => {
    const result = searchParamsSchema.safeParse({
      type: "yacht",
      location: "20000000-0000-0000-0000-000000000001",
      guests: "6",
      priceMin: "500",
      priceMax: "5000",
      lengthMin: "10",
      lengthMax: "25",
      cabinsMin: "2",
      dateFrom: "2026-09-01",
      dateTo: "2026-09-10",
      sort: "length_desc",
      cursor: "4.5:vessel-1",
    });
    expect(result.success).toBe(true);
  });
});

describe("parseSearchParams", () => {
  it("returns an empty filter set for an empty searchParams object", () => {
    expect(parseSearchParams({})).toEqual({});
  });

  it("flattens array-valued searchParams to their first entry", () => {
    const result = parseSearchParams({ type: ["catamaran", "yacht"] });
    expect(result.type).toBe("catamaran");
  });

  it("falls back to no filters when one field is invalid, rather than throwing", () => {
    expect(() => parseSearchParams({ dateFrom: "2026-09-10", dateTo: "2026-09-01" })).not.toThrow();
    expect(parseSearchParams({ dateFrom: "2026-09-10", dateTo: "2026-09-01" })).toEqual({});
  });
});

describe("buildSearchUrl", () => {
  it("returns the bare path when no filter is set", () => {
    expect(buildSearchUrl({})).toBe("/search");
  });

  it("includes only the fields that are present", () => {
    expect(buildSearchUrl({ guests: 4 })).toBe("/search?guests=4");
  });

  it("never includes a cursor even if one sneaks into the input type", () => {
    const url = buildSearchUrl({ type: "yacht", sort: "price_asc" });
    expect(url).not.toContain("cursor");
  });

  it("combines every filter at once", () => {
    const url = buildSearchUrl({
      type: "catamaran",
      guests: 6,
      priceMin: 500,
      priceMax: 5000,
      dateFrom: "2026-09-01",
      dateTo: "2026-09-10",
      sort: "length_desc",
    });
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.get("type")).toBe("catamaran");
    expect(params.get("guests")).toBe("6");
    expect(params.get("priceMin")).toBe("500");
    expect(params.get("priceMax")).toBe("5000");
    expect(params.get("dateFrom")).toBe("2026-09-01");
    expect(params.get("dateTo")).toBe("2026-09-10");
    expect(params.get("sort")).toBe("length_desc");
  });
});

describe("activeFilterChipKeys", () => {
  it("returns nothing for an empty filter set", () => {
    expect(activeFilterChipKeys({})).toEqual([]);
  });

  it("collapses a complete date range into a single 'dates' chip", () => {
    expect(activeFilterChipKeys({ dateFrom: "2026-09-01", dateTo: "2026-09-10" })).toEqual(["dates"]);
  });

  it("never reports a 'dates' chip for a lone end", () => {
    expect(activeFilterChipKeys({ dateFrom: "2026-09-01" })).toEqual([]);
    expect(activeFilterChipKeys({ dateTo: "2026-09-10" })).toEqual([]);
  });

  it("reports one chip per other active filter", () => {
    const keys = activeFilterChipKeys({ type: "yacht", guests: 4, priceMax: 2000 });
    expect(keys).toEqual(["type", "guests", "priceMax"]);
  });
});

describe("removeSearchFilterUrl", () => {
  it("drops only the requested chip, keeping every other filter", () => {
    const filters = { type: "yacht" as const, guests: 4, priceMax: 2000 };
    const url = removeSearchFilterUrl(filters, "guests");
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.get("type")).toBe("yacht");
    expect(params.has("guests")).toBe(false);
    expect(params.get("priceMax")).toBe("2000");
  });

  it("drops both ends of the date range for the 'dates' chip", () => {
    const filters = { dateFrom: "2026-09-01", dateTo: "2026-09-10", guests: 4 };
    const url = removeSearchFilterUrl(filters, "dates");
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.has("dateFrom")).toBe(false);
    expect(params.has("dateTo")).toBe(false);
    expect(params.get("guests")).toBe("4");
  });

  it("drops the cursor along with the targeted filter", () => {
    const filters = { guests: 4, cursor: "4.5:vessel-1" };
    const url = removeSearchFilterUrl(filters, "guests");
    expect(url).not.toContain("cursor");
  });
});
