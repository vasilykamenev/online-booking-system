import "server-only";
import { createGenericProvider } from "@/server/search/providers/generic/provider";
import type { SearchSource } from "@/server/search/source-registry";
import type { VesselSourceAdapter } from "@/server/search/adapters/adapter";

/**
 * Completes `providers/generic/provider.ts`'s search-only factory into a full `VesselSourceAdapter`
 * (Э4). Eligibility (`supports`) is the same check `provider-registry.ts`'s `isGenericEligible` used
 * to make free-standing: `AI_EXTRACTION`/`STRUCTURED_DATA` always, `HTML`/`HYBRID` only once an
 * admin has filled in `selectorConfig` — without one there is nothing for a generic pass to read
 * deterministically, same as `API`, which this never attempts.
 *
 * `getDetails`/`checkAvailability` are honest, not stubs: no per-listing detail fetch or live
 * calendar check has been built for an arbitrary registered site yet (Э9/Э5's job), so `null`/
 * `UNKNOWN` is the correct answer today, not a placeholder for "not implemented" (see `adapter.ts`'s
 * own doc comment on this distinction).
 */
export function createGenericAdapter(source: SearchSource): VesselSourceAdapter {
  const provider = createGenericProvider(source);

  return {
    sourceId: provider.id,
    search: provider.search,

    supports: () => {
      switch (source.processingType) {
        case "AI_EXTRACTION":
        case "STRUCTURED_DATA":
          return true;
        case "HTML":
        case "HYBRID":
          return source.selectorConfig !== null;
        case "API":
          return false;
      }
    },

    getDetails: async () => null,
    checkAvailability: async () => ({ status: "UNKNOWN", confidence: null }),
    getContactCapability: () => source.contactCapability ?? "REDIRECT_ONLY",
  };
}
