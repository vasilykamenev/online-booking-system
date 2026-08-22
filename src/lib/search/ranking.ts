import type { SearchCriteria } from "@/lib/search/criteria";
import { dataCompleteness, type VesselSearchResult } from "@/lib/search/result";
import { normalizeForMatch } from "@/lib/search/text";

/**
 * `SearchRankingService` (spec §18), as pure functions.
 *
 * The central idea is that a factor can be **not applicable**, which is different from scoring
 * zero. If the query says nothing about price, a result should be neither rewarded nor punished
 * for its price — so `scorePrice` returns `null` and the factor drops out of the weighted average
 * entirely. Scoring it 0 (or a neutral 0.5) would dilute the factors the user actually cared
 * about, and a query mentioning only a country would end up sorted mostly by noise.
 */

export interface RankingWeights {
  location: number;
  capacity: number;
  price: number;
  vesselType: number;
  date: number;
  features: number;
  completeness: number;
  sourceReliability: number;
}

export const defaultRankingWeights: RankingWeights = {
  location: 0.2,
  capacity: 0.15,
  price: 0.15,
  vesselType: 0.12,
  date: 0.13,
  features: 0.1,
  completeness: 0.08,
  sourceReliability: 0.07,
};

/**
 * Spec §18: "При сопоставимом качестве результата допустимо отдавать преимущество предложениям из
 * собственной системы." Deliberately small — a tiebreak between comparable results, not a thumb
 * heavy enough to float a poor internal match above a good external one.
 */
export const INTERNAL_ORIGIN_BONUS = 0.03;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function sameLabel(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  return normalizeForMatch(a) === normalizeForMatch(b);
}

/** Averages over the location parts the query actually named, ignoring the rest. */
export function scoreLocation(result: VesselSearchResult, criteria: SearchCriteria): number | null {
  const wanted = criteria.location;
  if (!wanted) return null;

  const parts: boolean[] = [];
  if (wanted.country) parts.push(sameLabel(wanted.country, result.location.country));
  if (wanted.region) parts.push(sameLabel(wanted.region, result.location.region));
  if (wanted.city) parts.push(sameLabel(wanted.city, result.location.city));
  if (wanted.marina) parts.push(sameLabel(wanted.marina, result.location.marina));
  if (parts.length === 0) return null;

  return parts.filter(Boolean).length / parts.length;
}

/**
 * A vessel that can't fit the party is close to useless, but not disqualifying — the extractor may
 * simply have read the berth count wrong. A vessel far larger than needed is a weaker match too:
 * it exists, but the user will be paying for space they didn't ask for.
 */
export function scoreCapacity(result: VesselSearchResult, criteria: SearchCriteria): number | null {
  const wanted = criteria.capacity?.persons ?? null;
  if (wanted === null) return null;
  const available = result.capacity.guests;
  if (available === null) return null;

  if (available < wanted) return 0.1;
  if (available <= wanted * 2) return 1;
  // Decays with the ratio and floors at 0.3: a 30-berth vessel for a party of four is a poor fit,
  // but it is still a real, bookable offer and shouldn't be pushed below results that fit nothing.
  return Math.max(0.3, (wanted * 2) / available);
}

/**
 * Returns `null` when the currencies differ. Converting would need live FX rates the project
 * doesn't carry, and comparing 5000 EUR against 5000 RUB as if they were the same number would
 * mis-rank far worse than simply not scoring this factor.
 */
export function scorePrice(result: VesselSearchResult, criteria: SearchCriteria): number | null {
  const budget = criteria.price?.maxMinor ?? null;
  if (budget === null) return null;

  const price = result.rental.priceMinor;
  if (price === null) return null;
  if (criteria.price?.currency && result.rental.currency) {
    if (criteria.price.currency !== result.rental.currency) return null;
  }

  if (price <= budget) return 1;
  // Fades out rather than cutting off: 20% over budget is still worth showing, 2x over is not.
  return clamp01(1 - (price - budget) / budget);
}

export function scoreVesselType(result: VesselSearchResult, criteria: SearchCriteria): number | null {
  if (!criteria.vesselType) return null;
  if (result.vesselType === null) return null;
  return result.vesselType === criteria.vesselType ? 1 : 0;
}

/** ISO `YYYY-MM-DD` strings compare correctly as plain strings — no Date parsing needed. */
function rangesOverlap(aFrom: string, aTo: string, bFrom: string, bTo: string): boolean {
  return aFrom <= bTo && bFrom <= aTo;
}

/** Every month number touched by an ISO date window, capped so a decade-long window can't spin. */
function monthsInRange(from: string, to: string): Set<number> {
  const months = new Set<number>();
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return months;

  const cursor = new Date(start);
  for (let step = 0; step < 24 && cursor <= end; step += 1) {
    months.add(cursor.getUTCMonth() + 1);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return months;
}

/**
 * Handles both flavours of date criteria: an exact window scores on overlap, a bare month (spec
 * §4's "в сентябре") scores on whether the offer is available in that month at all.
 */
export function scoreDate(result: VesselSearchResult, criteria: SearchCriteria): number | null {
  const wanted = criteria.date;
  if (!wanted) return null;

  const { from, to } = result.availability;
  if (!from || !to) return null;

  if (wanted.from && wanted.to) {
    return rangesOverlap(wanted.from, wanted.to, from, to) ? 1 : 0;
  }
  if (wanted.from) return wanted.from >= from && wanted.from <= to ? 1 : 0;
  if (wanted.month !== null) {
    return monthsInRange(from, to).has(wanted.month) ? 1 : 0;
  }
  return null;
}

export function scoreFeatures(result: VesselSearchResult, criteria: SearchCriteria): number | null {
  if (criteria.features.length === 0) return null;
  const present = new Set(result.features.map(normalizeForMatch));
  const matched = criteria.features.filter((feature) => present.has(normalizeForMatch(feature)));
  return matched.length / criteria.features.length;
}

export interface RankingOptions {
  weights?: RankingWeights;
  /**
   * Reliability per source domain, 0.0-1.0, from `SearchSource.reliabilityScore`. Internal results
   * always score 1. An unlisted domain falls back to `defaultSourceReliability`.
   */
  sourceReliability?: Record<string, number>;
  defaultSourceReliability?: number;
}

/** Scores one result, keeping the per-factor breakdown for debugging and explainability. */
export function scoreResult(
  result: VesselSearchResult,
  criteria: SearchCriteria,
  options: RankingOptions = {},
): { score: number; breakdown: Record<string, number> } {
  const weights = options.weights ?? defaultRankingWeights;
  const reliability =
    result.origin === "INTERNAL"
      ? 1
      : (result.source.domain ? options.sourceReliability?.[result.source.domain] : undefined) ??
        options.defaultSourceReliability ??
        0.5;

  const factors: Array<[keyof RankingWeights, number | null]> = [
    ["location", scoreLocation(result, criteria)],
    ["capacity", scoreCapacity(result, criteria)],
    ["price", scorePrice(result, criteria)],
    ["vesselType", scoreVesselType(result, criteria)],
    ["date", scoreDate(result, criteria)],
    ["features", scoreFeatures(result, criteria)],
    // These two always apply: they describe the result itself, not its fit to the query.
    ["completeness", dataCompleteness(result)],
    ["sourceReliability", reliability],
  ];

  const breakdown: Record<string, number> = {};
  let weightedSum = 0;
  let totalWeight = 0;

  for (const [name, value] of factors) {
    if (value === null) continue;
    breakdown[name] = value;
    weightedSum += value * weights[name];
    totalWeight += weights[name];
  }

  // Renormalizing by the applicable weight is what keeps a one-criterion query meaningful: with
  // only `location` scored, a perfect location match is 1.0, not 0.2.
  const base = totalWeight === 0 ? 0 : weightedSum / totalWeight;
  const bonus = result.origin === "INTERNAL" ? INTERNAL_ORIGIN_BONUS : 0;
  if (bonus) breakdown.internalOrigin = bonus;

  return { score: clamp01(base + bonus), breakdown };
}

/** Scores every result and returns them sorted best-first, with `ranking` attached. */
export function rankResults(
  results: VesselSearchResult[],
  criteria: SearchCriteria,
  options: RankingOptions = {},
): VesselSearchResult[] {
  return results
    .map((result) => ({ ...result, ranking: scoreResult(result, criteria, options) }))
    .sort((a, b) => {
      if (b.ranking.score !== a.ranking.score) return b.ranking.score - a.ranking.score;
      // Stable, deterministic tiebreak so repeated identical searches don't reshuffle results.
      return a.id.localeCompare(b.id);
    });
}
