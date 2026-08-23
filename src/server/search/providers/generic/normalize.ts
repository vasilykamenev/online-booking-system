import { emptyResult, type FieldProvenance, type ResultSource, type VesselSearchResult } from "@/lib/search/result";

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
