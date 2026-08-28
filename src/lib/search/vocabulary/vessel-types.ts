import type { VesselType } from "@/lib/search/result";
import { normalizeForMatch } from "@/lib/search/text";

/**
 * Maps a source's own wording onto the project's canonical vessel-type vocabulary (Арх §7:
 * "Sailboat/Sailing/Sailing Yacht → SAILING_YACHT"), as data rather than a hardcoded map
 * (CLAUDE.md §9) — `aliases` is meant to come from the `vessel_type_aliases` table
 * (supabase/migrations/20260828090001_vessel_type_canonical_vocabulary.sql), not be built into
 * this module.
 *
 * Matching is exact-after-normalization, not substring. A source's raw type field is a short
 * category label ("Моторные яхты", "Sailing Yacht"), never free prose — the README's documented
 * "ЯХТА ДЛЯ РЫБАЛКИ" bug (a fishing charter passing a "яхта" filter) is exactly the failure mode
 * substring matching would reintroduce here.
 */

export interface VesselTypeAlias {
  alias: string;
  vesselType: VesselType;
}

/**
 * `raw` is untrusted external text — missing, unrecognized, or empty input degrades to `null`
 * rather than guessing (same "absent beats invented" rule as `criteria.ts`'s `orNull`). Falls
 * back to `null` rather than `"OTHER"`: `OTHER` is only ever an explicit, curated alias entry,
 * never an inferred default.
 */
export function normalizeVesselType(
  raw: string | null,
  aliases: readonly VesselTypeAlias[],
): VesselType | null {
  if (!raw) return null;
  const normalized = normalizeForMatch(raw);
  if (!normalized) return null;

  const match = aliases.find((entry) => normalizeForMatch(entry.alias) === normalized);
  return match?.vesselType ?? null;
}
