import { emptyResult, type FieldProvenance, type ResultSource, type VesselSearchResult } from "@/lib/search/offer";
import { MINOR_UNITS_PER_MAJOR } from "@/lib/search/request";

/**
 * Folds one candidate page's extracted fields into the canonical `VesselSearchResult` (spec §13),
 * mirroring `providers/brilions/normalize.ts`'s split between orchestration and pure mapping — kept
 * separate so the mapping itself stays directly testable without mocking fetch/AI calls.
 */

export interface GenericExtractedFields {
  name: string | null;
  description: string | null;
  image: string | null;
  guests: number | null;
  cabins: number | null;
  /** The page's own wording for the vessel type — never mapped onto our `vessel_type` enum here
   *  (see `candidate-classifier.ts`'s doc comment: no site-specific vocabulary to map from
   *  reliably), so `vesselType` on the result is always `null`. Still shown to the user as free
   *  text via `vesselTypeRaw`. */
  vesselTypeRaw: string | null;
  country: string | null;
  city: string | null;
  /** Major units (e.g. `9500` for "9500 EUR"), as read off a source's own structured data —
   *  converted to minor units at this normalization boundary, same as `criteria.ts`'s interpreter
   *  output (CLAUDE.md §7: money is never a float downstream of here). */
  price: number | null;
  currency: string | null;
}

export interface NormalizeGenericInput {
  sourceUrl: string;
  sourceName: string;
  sourceDomain: string;
  retrievedAt: string;
  fields: GenericExtractedFields;
  /** Confidence from `classifyCandidatePage`, present only when an AI call actually produced these
   *  fields. `null` for JSON-LD-derived fields, which carry no provenance — same convention as
   *  every other provider (deterministic data needs no confidence score). */
  aiConfidence: number | null;
}

export function normalizeGenericResult({
  sourceUrl,
  sourceName,
  sourceDomain,
  retrievedAt,
  fields,
  aiConfidence,
}: NormalizeGenericInput): VesselSearchResult {
  const source: ResultSource = {
    type: "WEBSITE",
    name: sourceName,
    domain: sourceDomain,
    url: sourceUrl,
    retrievedAt,
  };

  const result = emptyResult(`${sourceDomain}:${sourceUrl}`, "EXTERNAL", source);
  const provenance: FieldProvenance | null =
    aiConfidence !== null ? { sourceUrl, confidence: aiConfidence } : null;

  return {
    ...result,
    name: fields.name,
    vesselType: null,
    vesselTypeRaw: fields.vesselTypeRaw,
    capacity: { guests: fields.guests, cabins: fields.cabins, beds: null },
    location: {
      country: fields.country,
      region: null,
      city: fields.city,
      marina: null,
      latitude: null,
      longitude: null,
    },
    rental: {
      ...result.rental,
      priceMinor: fields.price === null ? null : Math.round(fields.price * MINOR_UNITS_PER_MAJOR),
      currency: fields.currency,
    },
    description: fields.description,
    images: fields.image ? [{ url: fields.image, alt: fields.name }] : [],
    fieldProvenance: provenance
      ? {
          name: provenance,
          "capacity.guests": provenance,
          "capacity.cabins": provenance,
          vesselTypeRaw: provenance,
          "location.country": provenance,
          "location.city": provenance,
        }
      : {},
  };
}
