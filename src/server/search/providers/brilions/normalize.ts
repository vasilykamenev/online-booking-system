import { emptyResult, type ResultSource, type VesselSearchResult, type VesselType } from "@/lib/search/offer";
import type { DeterministicExtraction } from "@/server/search/providers/brilions/extract";
import type { AmenitiesExtraction } from "@/server/search/providers/brilions/amenities-extraction";

/**
 * Folds one page's deterministic + AI extraction into the canonical `VesselSearchResult` (spec
 * §13). Kept separate from the provider's crawl/cache orchestration so the mapping itself — the
 * part most likely to need a small correction as real pages are seen — is a pure, directly
 * testable function.
 */

/** Raw `Тип:`/`Type:` values observed on the site, mapped onto the project's own vessel_type enum.
 *  Deliberately conservative: only maps what's actually been seen; an unrecognized raw type stays
 *  in `vesselTypeRaw` rather than being forced into the nearest-sounding enum value. */
const RAW_TYPE_TO_VESSEL_TYPE: Record<string, VesselType> = {
  "моторные яхты": "MOTOR_YACHT",
  "motor yacht": "MOTOR_YACHT",
  катамаран: "CATAMARAN",
  catamaran: "CATAMARAN",
  гулет: "MOTOR_YACHT",
  gulet: "MOTOR_YACHT",
};

function mapVesselType(raw: string | null): VesselType | null {
  if (!raw) return null;
  return RAW_TYPE_TO_VESSEL_TYPE[raw.trim().toLowerCase()] ?? null;
}

/**
 * Brilions operates two fleets — Turkey and UAE — and the sitemap's `citySlugGuess` (spec: see
 * `sitemap.ts`) is the only signal available for which one a listing belongs to without an actual
 * page fetch confirming it. Deliberately a closed set built from the city-prefix distribution
 * observed during integration research (2026-08-21: bodrum, fethiye, antalya, marmaris, gocek,
 * kemer, stambul, dubai, alanya, kas, izmir, abu — plus the non-city outliers gulet/okay/hadron).
 * An unrecognized slug maps to `null`, never a guessed country — the same "absent beats invented"
 * rule as everywhere else in this module.
 */
const TURKEY_CITY_SLUGS = new Set([
  "bodrum",
  "fethiye",
  "antalya",
  "marmaris",
  "gocek",
  "kemer",
  "stambul",
  "alanya",
  "kas",
  "izmir",
]);
const UAE_CITY_SLUGS = new Set(["dubai", "abu"]);

function guessCountry(citySlugGuess: string): string | null {
  if (TURKEY_CITY_SLUGS.has(citySlugGuess)) return "Turkey";
  if (UAE_CITY_SLUGS.has(citySlugGuess)) return "United Arab Emirates";
  return null;
}

/**
 * Fix (found live): `guessCountry(citySlugGuess)` alone left `country` null for any listing whose
 * URL slug doesn't start with a recognized city — a boat-named slug (`gulet-alaturka-1`,
 * `hadron-gocek`, `okay-ii-bodrum`) has a `citySlugGuess` of "gulet"/"hadron"/"okay", not the real
 * city, even though `deterministic.city` states the real one correctly (confirmed live: the exact
 * same "Бодрум" appears with `country: 'Turkey'` on 57 rows whose slug happened to start with
 * "bodrum", and `country: null` on 2 rows with the identical city text but a boat-named slug) — a
 * `location.country`-scoped search then can't hard-exclude these as a known non-match
 * (`match-criteria.ts`'s own fix for the same underlying symptom), so they kept surfacing for
 * queries naming a different country entirely (observed: brilions.com's Turkey-only listings
 * showing up for a "Греция" query). `deterministic.city` — the page's own stated port, this
 * module's only actually-reliable location signal per `sitemap.ts`'s own doc comment on
 * `citySlugGuess` — resolves it correctly regardless of which word the slug happened to start
 * with, and is tried first; the slug guess remains only for the rarer case where the page stated no
 * city at all. A multi-port row ("Бодрум, Гёджек, Мармарис") still resolves via `includes` — every
 * currently-seen combination is entirely within one of these two fleets, never split across them.
 */
const TURKEY_CITY_NAMES = [
  "бодрум",
  "гёджек",
  "фетхие",
  "алания",
  "анталия",
  "мармарис",
  "измир",
  "каш",
  "кемер",
  "стамбул",
  "турция",
];
const UAE_CITY_NAMES = ["абу-даби", "дубай"];

function guessCountryFromCity(city: string | null): string | null {
  if (!city) return null;
  const normalized = city.toLowerCase();
  if (TURKEY_CITY_NAMES.some((name) => normalized.includes(name))) return "Turkey";
  if (UAE_CITY_NAMES.some((name) => normalized.includes(name))) return "United Arab Emirates";
  return null;
}

export interface NormalizeInput {
  vesselId: string;
  sourceUrl: string;
  retrievedAt: string;
  citySlugGuess: string;
  deterministic: DeterministicExtraction;
  amenities: AmenitiesExtraction;
}

export function normalizeBrilionsResult({
  vesselId,
  sourceUrl,
  retrievedAt,
  citySlugGuess,
  deterministic,
  amenities,
}: NormalizeInput): VesselSearchResult {
  const source: ResultSource = {
    type: "WEBSITE",
    name: "Brilions",
    domain: "brilions.com",
    url: sourceUrl,
    retrievedAt,
  };

  const result = emptyResult(`brilions:${vesselId}`, "EXTERNAL", source);

  return {
    ...result,
    name: deterministic.name,
    vesselType: mapVesselType(deterministic.vesselTypeRaw),
    vesselTypeRaw: deterministic.vesselTypeRaw,
    year: deterministic.year,
    lengthMeters: deterministic.lengthMeters,
    capacity: { guests: deterministic.guests, cabins: deterministic.cabins, beds: null },
    location: {
      country: guessCountryFromCity(deterministic.city) ?? guessCountry(citySlugGuess),
      region: null,
      city: deterministic.city,
      marina: null,
      latitude: null,
      longitude: null,
    },
    rental: {
      // No price is published anywhere on the site (confirmed on both listing cards and detail
      // pages during integration research) — never invented, and `scorePrice` already treats a
      // null price as "not applicable" rather than as zero, so this doesn't corrupt ranking.
      priceMinor: null,
      currency: null,
      priceUnit: null,
      minDuration: null,
      minDurationUnit: null,
      captainIncluded: amenities.captainIncluded,
      crewIncluded: amenities.crewIncluded,
    },
    description: deterministic.description,
    features: amenities.features,
    images: deterministic.images.map((url) => ({ url, alt: deterministic.name })),
    fieldProvenance:
      amenities.features.length > 0 || amenities.captainIncluded !== null || amenities.crewIncluded !== null
        ? {
            "features": { sourceUrl, confidence: amenities.confidence },
            "rental.captainIncluded": { sourceUrl, confidence: amenities.confidence },
            "rental.crewIncluded": { sourceUrl, confidence: amenities.confidence },
          }
        : {},
  };
}
