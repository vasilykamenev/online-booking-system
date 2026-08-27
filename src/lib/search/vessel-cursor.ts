import type { VesselSort } from "@/lib/validation/search";

/**
 * Keyset pagination for the catalog search page (`server/queries/vessels.ts`) — separate from
 * `ranking.ts` in this same folder, which orders results *within* one AI-search response and never
 * paginates. This is plain SQL `ORDER BY <column>, id` plus a cursor, one config per sort the UI
 * offers.
 */

interface VesselSortConfig {
  column: "rating_avg" | "base_price_minor" | "length_meters";
  ascending: boolean;
}

export const VESSEL_SORT_CONFIG: Record<VesselSort, VesselSortConfig> = {
  rating_desc: { column: "rating_avg", ascending: false },
  price_asc: { column: "base_price_minor", ascending: true },
  price_desc: { column: "base_price_minor", ascending: false },
  length_desc: { column: "length_meters", ascending: false },
};

/** Cursor is "<sort column value>:<id>", opaque to every caller outside this module. */
export function encodeVesselCursor(value: number, id: string): string {
  return `${value}:${id}`;
}

export interface DecodedVesselCursor {
  value: number;
  id: string;
}

/**
 * Null on a malformed cursor rather than throwing — a bad/stale cursor (e.g. a stored link from
 * before a sort was renamed) should just restart from the top of the results, the same "absent
 * beats invented" tolerance the rest of the search stack applies to bad input.
 */
export function decodeVesselCursor(cursor: string): DecodedVesselCursor | null {
  const [valueRaw, id] = cursor.split(":");
  const value = Number(valueRaw);
  if (!Number.isFinite(value) || !id) return null;
  return { value, id };
}

/** PostgREST `.or()` filter string for "rows after this cursor", honoring the sort's direction. */
export function buildVesselCursorFilter(sort: VesselSort, decoded: DecodedVesselCursor): string {
  const { column, ascending } = VESSEL_SORT_CONFIG[sort];
  const cmp = ascending ? "gt" : "lt";
  return `${column}.${cmp}.${decoded.value},and(${column}.eq.${decoded.value},id.lt.${decoded.id})`;
}
