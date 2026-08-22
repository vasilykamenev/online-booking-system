/**
 * Pure types/constants shared between `ai-extract.ts` (the actual model call, `"server-only"`)
 * and `normalize.ts` (which needs the shape but not the network code) — same split as
 * `robots-rules.ts`/`robots.ts`.
 */

export interface AmenitiesExtraction {
  features: string[];
  captainIncluded: boolean | null;
  crewIncluded: boolean | null;
  /** 0.0-1.0 — spec §15: an AI-extracted value must carry a confidence, never be presented as fact. */
  confidence: number;
}

export const emptyAmenitiesExtraction: AmenitiesExtraction = {
  features: [],
  captainIncluded: null,
  crewIncluded: null,
  confidence: 0,
};
