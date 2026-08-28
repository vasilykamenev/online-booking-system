import "server-only";
import {
  searchInternalVessels,
  getInternalVesselById,
  isInternalVesselAvailable,
} from "@/server/search/internal-provider";
import {
  emptyAdapterStats,
  type AdapterContext,
  type AdapterSearchResponse,
  type AvailabilityResult,
  type VesselSourceAdapter,
} from "@/server/search/adapters/adapter";
import type { SearchCriteria } from "@/lib/search/request";
import type { VesselSearchResult } from "@/lib/search/offer";

/**
 * Wraps `internal-provider.ts` in the same `VesselSourceAdapter` contract every external source
 * implements (Э4, Арх §10) — so the orchestrator can eventually consult "our own catalogue" through
 * the same uniform list as `generic-adapter.ts`/`brilions-adapter.ts`, instead of a hard-coded first
 * branch. `checkAvailability` is a genuine DB-backed check, not a placeholder: our own
 * `availability`/`bookings` tables are exactly what `searchInternalVessels` already reads live for a
 * whole page of candidates — this is the same guarantee, asked about one vessel.
 */
export function createInternalAdapter(): VesselSourceAdapter {
  return {
    sourceId: "internal",

    // Always eligible — there is no per-request condition that turns our own catalogue off.
    supports: () => true,

    async search(request: SearchCriteria, ctx: AdapterContext): Promise<AdapterSearchResponse> {
      try {
        const outcome = await searchInternalVessels(request, ctx.locale);
        return { results: outcome.results, stats: emptyAdapterStats, rejectedForDates: outcome.rejectedForDates, errors: [] };
      } catch (error) {
        // Never throws (see `adapter.ts`'s own doc comment) — a broken internal search must degrade
        // to "no internal results, external phase can still run", not fail the whole request.
        return { results: [], stats: emptyAdapterStats, rejectedForDates: 0, errors: [`internal: ${String(error)}`] };
      }
    },

    async getDetails(externalId: string, ctx: AdapterContext): Promise<VesselSearchResult | null> {
      try {
        // `externalId` is this adapter's own id space — for the internal adapter that is the
        // vessel's row id (`internalVesselId` on the result, see `offer.ts`).
        return await getInternalVesselById(externalId, ctx.locale);
      } catch {
        return null;
      }
    },

    async checkAvailability(externalId: string, from: string, to: string): Promise<AvailabilityResult> {
      try {
        const available = await isInternalVesselAvailable(externalId, from, to);
        return { status: available ? "VERIFIED" : "UNAVAILABLE", confidence: null };
      } catch {
        // A read failure here must not read as a confirmed booking — "we don't know" is the honest
        // fallback, same as an external source with no public calendar.
        return { status: "UNKNOWN", confidence: null };
      }
    },

    // Internal offers already have a real conversation thread (`conversations`/`messages`) — no new
    // channel needed.
    getContactCapability: () => "PLATFORM_MESSAGE",
  };
}

export const internalAdapter = createInternalAdapter();
