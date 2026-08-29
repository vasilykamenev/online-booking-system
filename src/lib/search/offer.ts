import type { Database } from "@/lib/supabase/database.types";
import type { DurationUnit, PriceUnit } from "@/lib/search/request";

/**
 * The canonical shape every result is normalized into (spec §13), whether it came from our own
 * Postgres or from a charter site's HTML. Spec §6 is explicit that internal and external results
 * must not diverge into two incompatible models — so this is deliberately a superset: fields our
 * DB has no column for (manufacturer, captainIncluded) are simply `null` for internal rows, and
 * fields only we have (slug, rating) are `null` for external ones.
 *
 * Everything is nullable for the same reason criteria are: an extractor that couldn't determine a
 * value must say so (§15), never guess.
 */

export type VesselType = Database["public"]["Enums"]["vessel_type"];

/** Where a result came from, kept on every row through aggregation (spec §16). */
export type ResultOrigin = "INTERNAL" | "EXTERNAL";

export type SourceType = "INTERNAL" | "WEBSITE" | "API";

/**
 * Арх §15's availability state machine. Full rule derivation (index freshness + live-verification
 * result + source reliability → this value) is Э7's job — this stage only adds the field and its
 * one unconditional rule: an internal offer is read straight from our own `availability`/`bookings`
 * tables at request time, so it is `VERIFIED` by construction, never inferred.
 */
export type OfferAvailabilityStatus = "VERIFIED" | "LIKELY_AVAILABLE" | "UNKNOWN" | "UNAVAILABLE";

/**
 * Extraction confidence for the offer as a whole (Арх §11's `confidence`) — distinct from
 * `RankingInfo.score`, which measures fit to the query, not trust in the data itself. `null` for
 * deterministic data (our own DB, a source's structured JSON-LD) — the same "absence is the signal"
 * rule `FieldProvenance.confidence` already follows, just at the offer level.
 */
export type OfferConfidence = "HIGH" | "MEDIUM" | "LOW" | null;

/**
 * How a user can reach out about this offer (Э3/Э9's `search_contact_capability`, not a DB enum
 * yet — same deferred-until-a-column-needs-it pattern as `PriceUnit`). `PLATFORM_MESSAGE` for
 * internal offers (existing `conversations`/`messages`); external offers leave this `null` until
 * Э3 gives `SourceProfile` a real capability to report.
 */
export type ContactCapability =
  | "EMAIL"
  | "PROVIDER_API"
  | "CONTACT_FORM"
  | "EXTERNAL_BOOKING_URL"
  | "PLATFORM_MESSAGE"
  | "REDIRECT_ONLY";

/**
 * Mandatory on every external result (spec §14): the user must always be able to open the page a
 * claim came from. Internal results carry it too — pointing at our own vessel page — so the UI
 * never needs a branch to render attribution.
 */
export interface ResultSource {
  type: SourceType;
  name: string;
  domain: string | null;
  /** Absolute URL for external sources; a locale-relative app path for internal ones. */
  url: string;
  retrievedAt: string;
}

/**
 * Per-field attribution (spec §14) plus extraction confidence (spec §15). Present only for fields
 * an AI extractor produced — deterministic data (our own DB, a site's JSON-LD) leaves this absent,
 * which is itself the signal that the value is not a guess.
 */
export interface FieldProvenance {
  sourceUrl: string | null;
  /** 0.0-1.0. `null` when the value came from a deterministic source rather than a model. */
  confidence: number | null;
}

export interface ResultCapacity {
  guests: number | null;
  cabins: number | null;
  beds: number | null;
}

/**
 * Plain strings, not the `{locale: label}` JSONB our `locations` table uses. External sources have
 * no notion of our locales, so the internal mapper resolves labels to the requesting locale at map
 * time. The trade-off is that a normalized result is locale-specific and can't be cached across
 * locales — acceptable, since the expensive part of a global search is the crawl, and the page
 * cache (spec §25) sits upstream of normalization.
 */
export interface ResultLocation {
  country: string | null;
  region: string | null;
  city: string | null;
  marina: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface ResultRental {
  /** Minor units, matching `vessels.base_price_minor` (CLAUDE.md §7). Never a float. */
  priceMinor: number | null;
  currency: string | null;
  priceUnit: PriceUnit | null;
  minDuration: number | null;
  minDurationUnit: DurationUnit | null;
  captainIncluded: boolean | null;
  crewIncluded: boolean | null;
}

export interface ResultAvailability {
  /** ISO dates. Semantics are "free between", the inverse of our `availability` table's blackouts. */
  from: string | null;
  to: string | null;
}

export interface ResultImage {
  url: string;
  alt: string | null;
}

/** Filled in by `SearchRankingService`; absent until a result has been ranked. */
export interface RankingInfo {
  /** 0.0-1.0 overall match against the criteria. */
  score: number;
  /** Per-factor contributions (spec §18), kept for debugging and for explaining the sort order. */
  breakdown: Record<string, number>;
}

export interface VesselSearchResult {
  /** Stable only within one search run — use `vesselIdentityId` for identity that persists across
   *  runs. */
  id: string;
  origin: ResultOrigin;
  /**
   * Э11 (Арх §17): the persistent identity this external offer was linked to by the background
   * indexer (`server/search/identity/vessel-identity.ts`), if any — `null` until the indexer has
   * visited this listing at least once, and always `null` for internal results (`vessels.id` is
   * already a durable identity, so this layer doesn't cover them; see the Э11 migration's own doc
   * comment). Two results sharing a non-null `vesselIdentityId` are the same vessel by definition —
   * `dedupe.ts`'s `dedupeResults` merges them without re-scoring.
   */
  vesselIdentityId: string | null;
  /** Set for internal results so the UI can deep-link into the real booking flow. */
  internalVesselId: string | null;
  slug: string | null;
  /** `search_sources.id` this offer came from (Арх §11). `null` for internal offers — they have no
   *  row in that registry, `origin: "INTERNAL"` already says where they're from. */
  sourceId: string | null;
  /** The offer's id on the source's own system, for `getDetails`/`checkAvailability` (Э4). `null`
   *  for internal offers, which use `internalVesselId` instead. */
  externalId: string | null;

  name: string | null;
  /** Constrained to our own enum so it stays directly filterable. `null` when unmappable. */
  vesselType: VesselType | null;
  /** The source's own wording ("motor yacht", "RIB") when it didn't map onto `vesselType`. */
  vesselTypeRaw: string | null;
  manufacturer: string | null;
  model: string | null;
  year: number | null;
  lengthMeters: number | null;

  capacity: ResultCapacity;
  location: ResultLocation;
  rental: ResultRental;
  availability: ResultAvailability;

  description: string | null;
  /** Amenity slugs where they matched our `amenities.key` reference table, raw labels otherwise. */
  features: string[];
  images: ResultImage[];

  /** Internal-only signals, `null` for external offers that carry no comparable rating. */
  ratingAvg: number | null;
  ratingCount: number | null;

  source: ResultSource;
  /**
   * Other places the same vessel was found, populated by deduplication (spec §17). A yacht listed
   * both in our DB and on two charter platforms collapses into one row that still lets the user
   * open every original listing — merging must never destroy a source link (spec §14).
   */
  alternateSources: ResultSource[];
  /** Keyed by dotted field path, e.g. `"rental.priceMinor"`. Sparse by design. */
  fieldProvenance: Record<string, FieldProvenance>;
  ranking?: RankingInfo;

  /** `VERIFIED` by construction for internal offers (read live from our own tables); `UNKNOWN`
   *  default for external ones until Э7 wires up real inference. */
  availabilityStatus: OfferAvailabilityStatus;
  confidence: OfferConfidence;
  /** When this offer was last written to `external_vessel_index` (Э5). `null` for internal offers
   *  and for any external offer still coming from the live-crawl path rather than the index. */
  indexedAt: string | null;
  /** When this offer's availability/price was last confirmed against the live source. Internal
   *  offers set this to the moment they were queried — the DB read *is* the verification. */
  verifiedAt: string | null;
  contactCapability: ContactCapability | null;
}

/**
 * A blank canonical result. Extractors start here and fill in only what they actually determined,
 * which makes "field absent" the default rather than something each extractor must remember.
 */
export function emptyResult(id: string, origin: ResultOrigin, source: ResultSource): VesselSearchResult {
  return {
    id,
    origin,
    vesselIdentityId: null,
    internalVesselId: null,
    slug: null,
    sourceId: null,
    externalId: null,
    name: null,
    vesselType: null,
    vesselTypeRaw: null,
    manufacturer: null,
    model: null,
    year: null,
    lengthMeters: null,
    capacity: { guests: null, cabins: null, beds: null },
    location: { country: null, region: null, city: null, marina: null, latitude: null, longitude: null },
    rental: {
      priceMinor: null,
      currency: null,
      priceUnit: null,
      minDuration: null,
      minDurationUnit: null,
      captainIncluded: null,
      crewIncluded: null,
    },
    availability: { from: null, to: null },
    description: null,
    features: [],
    images: [],
    ratingAvg: null,
    ratingCount: null,
    source,
    alternateSources: [],
    fieldProvenance: {},
    // Honest default for a result nobody has verified yet — `searchInternalVessels` overrides this
    // to `"VERIFIED"`, since reading it live from our own tables *is* the verification.
    availabilityStatus: "UNKNOWN",
    confidence: null,
    indexedAt: null,
    verifiedAt: null,
    contactCapability: null,
  };
}

/**
 * How complete a result is, 0.0-1.0 — a ranking factor in its own right (spec §18: "data
 * completeness"). A sparsely extracted external offer should not outrank a fully specified one
 * purely because its single known field happened to match.
 */
export function dataCompleteness(result: VesselSearchResult): number {
  const checks = [
    result.name,
    result.vesselType ?? result.vesselTypeRaw,
    result.year,
    result.lengthMeters,
    result.capacity.guests,
    result.capacity.cabins,
    result.location.country,
    result.location.city,
    result.rental.priceMinor,
    result.rental.currency,
    result.description,
    result.images.length > 0 ? "images" : null,
  ];
  const present = checks.filter((value) => value !== null && value !== undefined).length;
  return present / checks.length;
}

/**
 * The unified payload returned to the UI (spec §19). `interpretedCriteria` travels with the
 * results so the client can render editable criteria chips without re-interpreting the query.
 */
export interface UnifiedSearchResponse<TCriteria> {
  searchId: string;
  query: string;
  interpretedCriteria: TCriteria;
  results: VesselSearchResult[];
  sources: ResultSource[];
  meta: {
    internalResults: number;
    externalResults: number;
    sourcesChecked: number;
    searchDurationMs: number;
    /** True when the interpreter fell back to deterministic parsing (no AI key, or the call failed). */
    interpretationDegraded: boolean;
    /** External phase state, so the UI can show "ищем ещё" without inventing its own state machine. */
    externalPhase: "SKIPPED" | "PENDING" | "COMPLETE" | "FAILED";
  };
}
