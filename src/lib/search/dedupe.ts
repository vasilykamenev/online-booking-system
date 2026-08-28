import type { VesselSearchResult } from "@/lib/search/offer";
import { dataCompleteness } from "@/lib/search/offer";
import { normalizeForMatch, tokenSimilarity } from "@/lib/search/text";

/**
 * `VesselDeduplicationService` (spec §17). One vessel routinely appears in our own DB, on its
 * owner's site, and on two charter platforms — showing it four times makes the result list useless.
 *
 * Spec §17's constraint shapes the whole design: "при низкой уверенности результаты нельзя
 * автоматически объединять". Wrongly merging two similar-but-distinct yachts destroys a real offer
 * and attributes one vessel's price to another, which is worse than showing a near-duplicate. So
 * merging requires *positive* evidence past a deliberately high threshold, and any hard
 * contradiction (different build years, lengths metres apart) vetoes the merge outright.
 */

/** Above this combined score two results are considered the same vessel. */
export const MERGE_THRESHOLD = 0.82;

/** Below this, names are too different for the pair to be worth scoring at all. */
const NAME_GATE = 0.5;

export interface DuplicateAssessment {
  score: number;
  /** True when the pair may be merged automatically. */
  confident: boolean;
  /** Per-signal contributions, kept so a questionable merge can be explained after the fact. */
  signals: Record<string, number>;
  /** Set when a hard contradiction vetoed the comparison, e.g. `"year"`. */
  vetoedBy?: string;
}

function sharesImage(a: VesselSearchResult, b: VesselSearchResult): boolean {
  if (a.images.length === 0 || b.images.length === 0) return false;
  const urls = new Set(a.images.map((image) => image.url));
  return b.images.some((image) => urls.has(image.url));
}

function labelsEqual(a: string | null, b: string | null): boolean | null {
  if (!a || !b) return null;
  return normalizeForMatch(a) === normalizeForMatch(b);
}

/**
 * Scores how likely two results describe the same vessel.
 *
 * Vetoes come first and are absolute. A build year is a hard identity fact: two listings that
 * disagree on it are two different hulls, however similar their names. Same for a length gap
 * beyond measurement noise — charter sites round differently, so the tolerance is generous, but
 * a metre and a half apart is a different boat.
 */
export function assessDuplicate(a: VesselSearchResult, b: VesselSearchResult): DuplicateAssessment {
  const signals: Record<string, number> = {};

  if (a.year !== null && b.year !== null && a.year !== b.year) {
    return { score: 0, confident: false, signals, vetoedBy: "year" };
  }
  if (a.lengthMeters !== null && b.lengthMeters !== null) {
    if (Math.abs(a.lengthMeters - b.lengthMeters) > 1.5) {
      return { score: 0, confident: false, signals, vetoedBy: "length" };
    }
  }

  // An identical image URL is near-proof: two sites reusing the same asset are listing one vessel.
  const imageMatch = sharesImage(a, b);
  const nameSimilarity = a.name && b.name ? tokenSimilarity(a.name, b.name) : 0;

  if (!imageMatch && nameSimilarity < NAME_GATE) {
    return { score: 0, confident: false, signals: { name: nameSimilarity } };
  }

  signals.name = nameSimilarity;
  if (imageMatch) signals.image = 1;

  const manufacturerMatch = labelsEqual(a.manufacturer, b.manufacturer);
  if (manufacturerMatch !== null) signals.manufacturer = manufacturerMatch ? 1 : 0;

  const modelMatch = labelsEqual(a.model, b.model);
  if (modelMatch !== null) signals.model = modelMatch ? 1 : 0;

  if (a.year !== null && b.year !== null) signals.year = 1; // Equal, or the veto above would have fired.

  if (a.lengthMeters !== null && b.lengthMeters !== null) {
    signals.length = 1 - Math.abs(a.lengthMeters - b.lengthMeters) / 1.5;
  }

  const cityMatch = labelsEqual(a.location.city, b.location.city);
  if (cityMatch !== null) signals.city = cityMatch ? 1 : 0;

  const marinaMatch = labelsEqual(a.location.marina, b.location.marina);
  if (marinaMatch !== null) signals.marina = marinaMatch ? 1 : 0;

  const weights: Record<string, number> = {
    name: 0.35,
    image: 0.3,
    manufacturer: 0.1,
    model: 0.12,
    year: 0.08,
    length: 0.08,
    city: 0.08,
    marina: 0.06,
  };

  let weighted = 0;
  let total = 0;
  for (const [key, value] of Object.entries(signals)) {
    weighted += value * (weights[key] ?? 0);
    total += weights[key] ?? 0;
  }
  const score = total === 0 ? 0 : weighted / total;

  return { score, confident: score >= MERGE_THRESHOLD, signals };
}

/**
 * Picks which of two duplicates survives. Internal results win regardless of completeness: only
 * they can carry the user into a real booking flow, which is worth more than a couple of extra
 * extracted fields. Otherwise the richer record wins.
 */
function preferPrimary(a: VesselSearchResult, b: VesselSearchResult): [VesselSearchResult, VesselSearchResult] {
  if (a.origin === "INTERNAL" && b.origin !== "INTERNAL") return [a, b];
  if (b.origin === "INTERNAL" && a.origin !== "INTERNAL") return [b, a];
  return dataCompleteness(a) >= dataCompleteness(b) ? [a, b] : [b, a];
}

/**
 * Folds `duplicate` into `primary`: the primary's own values always win, the duplicate only fills
 * gaps. That keeps provenance honest — a field's value and the `source` it is attributed to never
 * come from different places unless `fieldProvenance` says so explicitly.
 */
export function mergeResults(
  primary: VesselSearchResult,
  duplicate: VesselSearchResult,
): VesselSearchResult {
  const fillScalar = <T>(own: T | null, other: T | null): T | null => own ?? other;

  return {
    ...primary,
    internalVesselId: fillScalar(primary.internalVesselId, duplicate.internalVesselId),
    slug: fillScalar(primary.slug, duplicate.slug),
    sourceId: fillScalar(primary.sourceId, duplicate.sourceId),
    externalId: fillScalar(primary.externalId, duplicate.externalId),
    name: fillScalar(primary.name, duplicate.name),
    vesselType: fillScalar(primary.vesselType, duplicate.vesselType),
    vesselTypeRaw: fillScalar(primary.vesselTypeRaw, duplicate.vesselTypeRaw),
    manufacturer: fillScalar(primary.manufacturer, duplicate.manufacturer),
    model: fillScalar(primary.model, duplicate.model),
    year: fillScalar(primary.year, duplicate.year),
    lengthMeters: fillScalar(primary.lengthMeters, duplicate.lengthMeters),
    capacity: {
      guests: fillScalar(primary.capacity.guests, duplicate.capacity.guests),
      cabins: fillScalar(primary.capacity.cabins, duplicate.capacity.cabins),
      beds: fillScalar(primary.capacity.beds, duplicate.capacity.beds),
    },
    location: {
      country: fillScalar(primary.location.country, duplicate.location.country),
      region: fillScalar(primary.location.region, duplicate.location.region),
      city: fillScalar(primary.location.city, duplicate.location.city),
      marina: fillScalar(primary.location.marina, duplicate.location.marina),
      latitude: fillScalar(primary.location.latitude, duplicate.location.latitude),
      longitude: fillScalar(primary.location.longitude, duplicate.location.longitude),
    },
    rental: {
      priceMinor: fillScalar(primary.rental.priceMinor, duplicate.rental.priceMinor),
      currency: fillScalar(primary.rental.currency, duplicate.rental.currency),
      priceUnit: fillScalar(primary.rental.priceUnit, duplicate.rental.priceUnit),
      minDuration: fillScalar(primary.rental.minDuration, duplicate.rental.minDuration),
      minDurationUnit: fillScalar(primary.rental.minDurationUnit, duplicate.rental.minDurationUnit),
      captainIncluded: fillScalar(primary.rental.captainIncluded, duplicate.rental.captainIncluded),
      crewIncluded: fillScalar(primary.rental.crewIncluded, duplicate.rental.crewIncluded),
    },
    availability: {
      from: fillScalar(primary.availability.from, duplicate.availability.from),
      to: fillScalar(primary.availability.to, duplicate.availability.to),
    },
    description: fillScalar(primary.description, duplicate.description),
    features: [...new Set([...primary.features, ...duplicate.features])],
    images: [
      ...primary.images,
      ...duplicate.images.filter(
        (image) => !primary.images.some((existing) => existing.url === image.url),
      ),
    ],
    ratingAvg: fillScalar(primary.ratingAvg, duplicate.ratingAvg),
    ratingCount: fillScalar(primary.ratingCount, duplicate.ratingCount),
    // Every listing the vessel was found on stays reachable — spec §14 forbids dropping a source.
    alternateSources: [
      ...primary.alternateSources,
      duplicate.source,
      ...duplicate.alternateSources,
    ].filter(
      (source, index, all) => all.findIndex((candidate) => candidate.url === source.url) === index,
    ),
    fieldProvenance: { ...duplicate.fieldProvenance, ...primary.fieldProvenance },
    // `availabilityStatus` is intentionally left at `...primary`'s value above rather than filled
    // from `duplicate` — it isn't a "gap" the way a null field is, and picking whichever status
    // happens to be more optimistic would misrepresent the primary listing (Э7 owns real rules for
    // reconciling two sources that disagree on availability).
    confidence: fillScalar(primary.confidence, duplicate.confidence),
    indexedAt: fillScalar(primary.indexedAt, duplicate.indexedAt),
    verifiedAt: fillScalar(primary.verifiedAt, duplicate.verifiedAt),
    contactCapability: fillScalar(primary.contactCapability, duplicate.contactCapability),
  };
}

/**
 * Collapses confident duplicates, preserving input order for everything else.
 *
 * O(n²) by design: a global search returns tens of offers, not thousands, and every candidate pair
 * has to be assessed on several signals. Blocking by a cheap key (e.g. first name token) is the
 * obvious optimization if result volumes ever justify it.
 */
export function dedupeResults(results: VesselSearchResult[]): VesselSearchResult[] {
  const merged: VesselSearchResult[] = [];

  for (const candidate of results) {
    const existingIndex = merged.findIndex(
      (existing) => assessDuplicate(existing, candidate).confident,
    );
    if (existingIndex === -1) {
      merged.push(candidate);
      continue;
    }
    const [primary, duplicate] = preferPrimary(merged[existingIndex], candidate);
    merged[existingIndex] = mergeResults(primary, duplicate);
  }

  return merged;
}
