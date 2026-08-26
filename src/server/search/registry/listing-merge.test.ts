import { describe, expect, it } from "vitest";
import { mergeExtractedListing, type IncomingExtraction, type StoredListing } from "./listing-merge";

const RETRIEVED_AT = "2026-08-26T10:00:00.000Z";

function incoming(overrides: Partial<IncomingExtraction> = {}): IncomingExtraction {
  return {
    fields: {},
    source: "JSON_LD",
    confidence: 0.9,
    sourceUrl: "https://example.com/yachts/aurora",
    retrievedAt: RETRIEVED_AT,
    ...overrides,
  };
}

describe("mergeExtractedListing", () => {
  it("fills in fields with no prior row, without flagging a conflict", () => {
    const result = mergeExtractedListing(null, {}, incoming({ fields: { name: "Aurora", guests: 8 } }));

    expect(result.fields.name).toBe("Aurora");
    expect(result.fields.guests).toBe(8);
    expect(result.fieldProvenance.name).toEqual({
      source: "JSON_LD",
      confidence: 0.9,
      retrievedAt: RETRIEVED_AT,
      sourceUrl: "https://example.com/yachts/aurora",
    });
    expect(result.newConflicts).toEqual([]);
    expect(result.resolvedConflicts).toEqual([]);
  });

  it("leaves a field untouched when the incoming extraction has no opinion on it", () => {
    const existing: StoredListing = {
      fields: { name: "Aurora", guests: 8 },
      fieldProvenance: {
        name: { source: "JSON_LD", confidence: 0.9, retrievedAt: RETRIEVED_AT, sourceUrl: "https://example.com" },
      },
    };

    const result = mergeExtractedListing(existing, {}, incoming({ fields: { guests: null } } as never));

    expect(result.fields.name).toBe("Aurora");
    expect(result.fields.guests).toBe(8);
    expect(result.newConflicts).toEqual([]);
  });

  it("confirms an unchanged value and refreshes its provenance", () => {
    const existing: StoredListing = {
      fields: { name: "Aurora" },
      fieldProvenance: {
        name: { source: "JSON_LD", confidence: 0.9, retrievedAt: "2026-08-01T00:00:00.000Z", sourceUrl: "https://old.example.com" },
      },
    };

    const result = mergeExtractedListing(existing, {}, incoming({ fields: { name: "aurora " } }));

    expect(result.fields.name).toBe("aurora ");
    expect(result.fieldProvenance.name?.retrievedAt).toBe(RETRIEVED_AT);
    expect(result.newConflicts).toEqual([]);
  });

  it("logs a conflict and keeps the previous value on first disagreement", () => {
    const existing: StoredListing = {
      fields: { name: "Aurora Explorer" },
      fieldProvenance: {
        name: { source: "JSON_LD", confidence: 0.9, retrievedAt: "2026-08-01T00:00:00.000Z", sourceUrl: "https://old.example.com" },
      },
    };

    const result = mergeExtractedListing(existing, {}, incoming({ source: "AI", confidence: 0.7, fields: { name: "Ocean Explorer" } }));

    expect(result.fields.name).toBe("Aurora Explorer"); // kept, not silently overwritten
    expect(result.fieldProvenance.name?.confidence).toBe(0.6); // 0.9 - 0.3
    expect(result.newConflicts).toEqual([
      {
        field: "name",
        previousValue: "Aurora Explorer",
        newValue: "Ocean Explorer",
        previousSource: "JSON_LD",
        newSource: "AI",
      },
    ]);
    expect(result.resolvedConflicts).toEqual([]);
  });

  it("floors the lowered confidence at 0.1 instead of going negative", () => {
    const existing: StoredListing = {
      fields: { name: "Aurora" },
      fieldProvenance: {
        name: { source: "AI", confidence: 0.2, retrievedAt: RETRIEVED_AT, sourceUrl: "https://example.com" },
      },
    };

    const result = mergeExtractedListing(existing, {}, incoming({ fields: { name: "Ocean" } }));

    expect(result.fieldProvenance.name?.confidence).toBe(0.1);
  });

  it("accepts a second, confirming crawl and resolves the open conflict", () => {
    const existing: StoredListing = {
      fields: { name: "Aurora Explorer" },
      fieldProvenance: {
        name: { source: "JSON_LD", confidence: 0.6, retrievedAt: "2026-08-01T00:00:00.000Z", sourceUrl: "https://old.example.com" },
      },
    };
    const openConflicts = { name: { id: "conflict-1", newValue: "Ocean Explorer" } };

    const result = mergeExtractedListing(existing, openConflicts, incoming({ source: "AI", confidence: 0.7, fields: { name: "Ocean Explorer" } }));

    expect(result.fields.name).toBe("Ocean Explorer");
    expect(result.fieldProvenance.name).toEqual({
      source: "AI",
      confidence: 0.7,
      retrievedAt: RETRIEVED_AT,
      sourceUrl: "https://example.com/yachts/aurora",
    });
    expect(result.resolvedConflicts).toEqual([{ field: "name", conflictId: "conflict-1" }]);
    expect(result.newConflicts).toEqual([]);
  });

  it("does not flag a small price fluctuation within tolerance as a conflict", () => {
    const existing: StoredListing = {
      fields: { price_minor: 950000 }, // 9500.00
      fieldProvenance: {
        price_minor: { source: "JSON_LD", confidence: 0.9, retrievedAt: RETRIEVED_AT, sourceUrl: "https://example.com" },
      },
    };

    const result = mergeExtractedListing(existing, {}, incoming({ fields: { price_minor: 950500 } })); // +0.05%

    expect(result.newConflicts).toEqual([]);
    expect(result.fields.price_minor).toBe(950500);
  });

  it("flags a large price change as a conflict", () => {
    const existing: StoredListing = {
      fields: { price_minor: 950000 },
      fieldProvenance: {
        price_minor: { source: "JSON_LD", confidence: 0.9, retrievedAt: RETRIEVED_AT, sourceUrl: "https://example.com" },
      },
    };

    const result = mergeExtractedListing(existing, {}, incoming({ fields: { price_minor: 1100000 } }));

    expect(result.fields.price_minor).toBe(950000);
    expect(result.newConflicts).toHaveLength(1);
    expect(result.newConflicts[0].field).toBe("price_minor");
  });

  it("compares text fields case-insensitively and ignoring surrounding whitespace", () => {
    const existing: StoredListing = {
      fields: { city: "Tromsø" },
      fieldProvenance: {
        city: { source: "AI", confidence: 0.8, retrievedAt: RETRIEVED_AT, sourceUrl: "https://example.com" },
      },
    };

    const result = mergeExtractedListing(existing, {}, incoming({ fields: { city: " tromsø " } }));

    expect(result.newConflicts).toEqual([]);
  });
});
