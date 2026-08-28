import "server-only";
import { brilionsProvider } from "@/server/search/providers/brilions/provider";
import type { SearchSource } from "@/server/search/source-registry";
import type { VesselSourceAdapter } from "@/server/search/adapters/adapter";

/**
 * Completes `providers/brilions/provider.ts`'s search-only object into a full `VesselSourceAdapter`
 * (Э4). Always `supports()` — brilions.com is a hand-tuned, site-specific implementation that wins
 * over the generic path regardless of the registry row's declared `processingType`
 * (`adapter-registry.ts`'s domain-first resolution already only ever calls this for that one
 * domain).
 *
 * `checkAvailability` is honestly `UNKNOWN`: the site publishes no public per-listing calendar to
 * check against (see `providers/brilions/provider.ts`'s own module doc comment on its
 * no-pricing/no-availability limitation) — a predicted outcome for this source, not a shortcoming
 * (Э4's own note).
 */
export function createBrilionsAdapter(source: SearchSource): VesselSourceAdapter {
  return {
    sourceId: brilionsProvider.id,
    search: brilionsProvider.search,
    supports: () => true,
    getDetails: async () => null,
    checkAvailability: async () => ({ status: "UNKNOWN", confidence: null }),
    getContactCapability: () => source.contactCapability ?? "REDIRECT_ONLY",
  };
}
