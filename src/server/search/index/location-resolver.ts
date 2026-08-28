import "server-only";
import { createClient } from "@/lib/supabase/server";
import { normalizeForMatch } from "@/lib/search/text";

/**
 * Resolves a page's own breadcrumb trail to a known place from the `locations` reference table —
 * distinct from `lib/search/structured-data.ts`'s `matchBreadcrumbLocation`, which only *confirms*
 * one specific wanted value from a live query (Арх §5's `location.country`/`city`). The background
 * indexer (Э5, Арх §12) has no query to confirm against; it needs to determine a page's location
 * from the trail alone, against everywhere the platform already knows about — a genuinely different
 * question, not a generalization of the live path's, which is why this is its own function rather
 * than a shared one with an optional "wanted" argument.
 */

type LocalizedRecord = Partial<Record<string, string>>;

interface LocationReferenceRow {
  country: LocalizedRecord | null;
  city: LocalizedRecord | null;
  marina: LocalizedRecord | null;
  latitude: number | null;
  longitude: number | null;
}

export interface ResolvedBreadcrumbLocation {
  country: string | null;
  city: string | null;
  marina: string | null;
  latitude: number | null;
  longitude: number | null;
}

/** The label as it actually appeared in the trail (whichever locale that happens to be) — never a
 *  translation of it, so the stored value is exactly what was confirmed, not a guess at its
 *  Russian/English equivalent. */
function matchingLabel(record: LocalizedRecord | null, normalizedLabels: Set<string>): string | null {
  if (!record) return null;
  for (const label of Object.values(record)) {
    if (label && normalizedLabels.has(normalizeForMatch(label))) return label;
  }
  return null;
}

function firstLabel(record: LocalizedRecord | null): string | null {
  if (!record) return null;
  return Object.values(record).find((value): value is string => Boolean(value)) ?? null;
}

/**
 * Most-specific match wins: a row whose marina appears in the trail is preferred over one that only
 * matches by country, so two marinas that both happen to be in Croatia never get conflated just
 * because both share that country label.
 *
 * `null` when nothing in the trail matches anything on record — an unrecognized place is left unset,
 * never guessed at (same "absent beats invented" rule as everywhere else in this pipeline). The
 * indexer stores whatever this returns as-is; a country the platform has never seen before simply
 * indexes with no location until an admin adds it to `locations`.
 *
 * Pure — no I/O — so it's directly testable against a fixed set of rows; `resolveLocationFromBreadcrumb`
 * below is the I/O wrapper that reads `locations` and calls this.
 */
export function pickBestLocationMatch(
  breadcrumbLabels: string[],
  rows: readonly LocationReferenceRow[],
): ResolvedBreadcrumbLocation | null {
  if (breadcrumbLabels.length === 0) return null;
  const normalizedLabels = new Set(breadcrumbLabels.map(normalizeForMatch));

  for (const row of rows) {
    const marina = matchingLabel(row.marina, normalizedLabels);
    if (!marina) continue;
    return {
      country: matchingLabel(row.country, normalizedLabels) ?? firstLabel(row.country),
      city: matchingLabel(row.city, normalizedLabels) ?? firstLabel(row.city),
      marina,
      latitude: row.latitude,
      longitude: row.longitude,
    };
  }

  for (const row of rows) {
    const city = matchingLabel(row.city, normalizedLabels);
    if (!city) continue;
    return {
      country: matchingLabel(row.country, normalizedLabels) ?? firstLabel(row.country),
      city,
      marina: null,
      latitude: row.latitude,
      longitude: row.longitude,
    };
  }

  for (const row of rows) {
    const country = matchingLabel(row.country, normalizedLabels);
    if (!country) continue;
    // Country-only match: no city/marina to safely attach — borrowing one from an unrelated row
    // sharing the same country would state a fact this trail never actually confirmed. Same for
    // lat/lng: a country has no single representative point worth storing.
    return { country, city: null, marina: null, latitude: null, longitude: null };
  }

  return null;
}

/** `locations` is read whole rather than queried per-label — same reasoning as
 *  `internal-provider.ts`'s `resolveLocationIds`: a small reference table, cheaper to compare in
 *  application code than to fight JSONB-locale query gymnastics over. */
export async function resolveLocationFromBreadcrumb(
  breadcrumbLabels: string[],
): Promise<ResolvedBreadcrumbLocation | null> {
  if (breadcrumbLabels.length === 0) return null;

  const supabase = await createClient();
  const { data, error } = await supabase.from("locations").select("country, city, marina, latitude, longitude");
  if (error || !data) return null;

  return pickBestLocationMatch(breadcrumbLabels, data as unknown as LocationReferenceRow[]);
}
