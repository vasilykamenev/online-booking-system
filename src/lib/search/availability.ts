import type { OfferAvailabilityStatus, OfferConfidence, ResultOrigin } from "@/lib/search/offer";

/**
 * Э7 (docs/AI_Federated_Search_Migration_Plan_v1.md §6, Арх §15): the one place that decides
 * `availabilityStatus`/`confidence` for a result — a pure function with its own tests, not a UI
 * heuristic (that stage's own "Правила вывода... Чистая функция с тестами, не эвристика внутри UI").
 *
 * Deliberately never persists a live `checkAvailability` outcome back onto `external_vessel_index`
 * for reuse by a *later* search: availability is a function of `(listing, date window)`, and a
 * listing row has no column for which window a past check covered. Reusing "last known status"
 * across an unrelated future date range would silently misreport it as confirmed for a window it
 * was never checked against — the same class of bug already hit once and fixed
 * (`registry/listing-index.ts`'s own doc comment: a JSON-LD location confirmed for one query's
 * criteria kept being served as fact to later, unrelated queries). Every input here is therefore
 * either this request's own live check or a date-independent signal (index freshness, source
 * reliability) — nothing that could leak between requests with different dates.
 */

/** Index freshness within which an unverified external candidate is still worth calling
 *  "likely available" rather than merely "unknown" — deliberately much shorter than
 *  `index/vessel-index.ts`'s `CANDIDATE_FRESHNESS_MS` (7 days, the cutoff for being a candidate at
 *  all): a week-old sighting is enough to surface a listing worth showing, but not enough on its own
 *  to suggest it's still likely bookable without a fresher signal or a live check. */
export const LIKELY_AVAILABLE_FRESHNESS_MS = 48 * 60 * 60 * 1000;

/** `reliabilityScore` (0.0–1.0) at or above this counts as "a source we trust enough" for the
 *  purposes of upgrading confidence — mirrors no existing threshold in `ranking.ts` (that module
 *  uses reliability as a continuous score, never a cutoff), chosen here only because confidence is
 *  inherently a small enum, not a continuous score, and needs some line drawn. */
const RELIABLE_SOURCE_THRESHOLD = 0.7;

export interface LiveVerification {
  /** The adapter's own `checkAvailability` outcome for *this* request's exact date window —
   *  never a value read back from storage (see this module's own doc comment on why). */
  status: OfferAvailabilityStatus;
  confidence: OfferConfidence;
}

export interface AvailabilityInput {
  origin: ResultOrigin;
  /** Injected rather than read from `Date.now()` internally — keeps this function deterministic and
   *  directly testable without faking the clock. */
  now: number;
  /** `external_vessel_index.indexed_at` (ISO) for the candidate this result came from — `null` for a
   *  result with no index backing at all (shouldn't happen for `EXTERNAL` in practice, but honestly
   *  handled rather than assumed). */
  indexedAt: string | null;
  /** This request's own live check, when Phase 2 attempted and succeeded one for this result —
   *  `null` when it wasn't attempted (no date window in the query, no adapter available) or failed
   *  (timeout, rejected promise). */
  liveVerification: LiveVerification | null;
  /** `SearchSource.reliabilityScore`, `null` when not yet measured (Э3's own convention). */
  sourceReliability: number | null;
}

export interface AvailabilityDerivation {
  status: OfferAvailabilityStatus;
  confidence: OfferConfidence;
}

/** Whether `reliability` clears the "trust this source enough to say MEDIUM/HIGH" bar — absent
 *  reliability data is treated as untrusted, not as neutral, matching `ranking.ts`'s own
 *  `defaultSourceReliability` fallback (0.5, below this threshold). */
function isReliableSource(reliability: number | null): boolean {
  return reliability !== null && reliability >= RELIABLE_SOURCE_THRESHOLD;
}

export function deriveAvailability(input: AvailabilityInput): AvailabilityDerivation {
  // Read live from our own tables at request time (`internal-provider.ts`'s `toResult`) — the query
  // *is* the verification, always, for every internal offer. Never downgraded by anything below.
  if (input.origin === "INTERNAL") {
    return { status: "VERIFIED", confidence: null };
  }

  // A live check just confirmed this exact window is gone — nothing else below can overrule that.
  if (input.liveVerification?.status === "UNAVAILABLE") {
    return { status: "UNAVAILABLE", confidence: input.liveVerification.confidence };
  }

  // A live check just confirmed the window works. External offers never claim `VERIFIED` — that
  // word is reserved for a read against our own tables (`offer.ts`'s own doc comment on
  // `OfferAvailabilityStatus`); the most a third-party check earns is `LIKELY_AVAILABLE`, with
  // confidence carrying how much that check is worth trusting.
  if (input.liveVerification && input.liveVerification.status !== "UNKNOWN") {
    return {
      status: "LIKELY_AVAILABLE",
      confidence: isReliableSource(input.sourceReliability) ? "HIGH" : "MEDIUM",
    };
  }

  // No live signal for this request (not attempted, or the adapter itself came back honestly
  // `UNKNOWN`) — fall back to how recently the background indexer last saw this listing at all.
  // That is a real, date-independent signal ("this exists and was still listed N days ago"), just a
  // weaker one than an actual availability check for the requested window.
  if (input.indexedAt !== null) {
    const ageMs = input.now - Date.parse(input.indexedAt);
    if (Number.isFinite(ageMs) && ageMs <= LIKELY_AVAILABLE_FRESHNESS_MS) {
      return {
        status: "LIKELY_AVAILABLE",
        confidence: isReliableSource(input.sourceReliability) ? "MEDIUM" : "LOW",
      };
    }
  }

  return { status: "UNKNOWN", confidence: null };
}
