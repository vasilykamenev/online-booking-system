import "server-only";
import { createBrilionsAdapter } from "@/server/search/adapters/brilions-adapter";
import { createGenericAdapter } from "@/server/search/adapters/generic-adapter";
import { internalAdapter } from "@/server/search/adapters/internal-adapter";
import { listEnabledSources, type SearchSource } from "@/server/search/source-registry";
import { sourceCovers } from "@/server/search/coverage";
import type { VesselSourceAdapter } from "@/server/search/adapters/adapter";
import { emptyCriteria, type SearchCriteria } from "@/lib/search/request";

/**
 * `VesselSourceAdapter` registry (Э4) — replaces `provider-registry.ts`. Domain → adapter factory:
 * a domain listed here always wins over the generic fallback, regardless of its `search_sources`
 * row's declared `processingType` — hand-tuned selectors beat a site-agnostic guess whenever someone
 * has actually written them.
 */
const ADAPTER_FACTORIES_BY_DOMAIN: Record<string, (source: SearchSource) => VesselSourceAdapter> = {
  "brilions.com": createBrilionsAdapter,
};

export interface ExternalAdapterList {
  adapters: VesselSourceAdapter[];
  /** Э3 (Арх §9): enabled sources excluded because their coverage doesn't include `request`'s
   *  location — distinct from an adapter that `supports()` declined, so `search_runs` can tell
   *  "wrong place" from "not wired up" (see `coverage.ts`'s `sourceCovers`). */
  skippedByCoverage: number;
}

/** Shared by `listExternalAdapters` and `listExternalAdaptersById` below — the coverage/eligibility
 *  filter is one rule, kept in one place so the two never drift into checking it differently. */
async function eligibleSources(request?: SearchCriteria) {
  const sources = await listEnabledSources();
  const covered = request ? sources.filter((source) => sourceCovers(source.coverage, request)) : sources;
  return { sources, covered };
}

/**
 * Every enabled, `status = 'active'` `search_sources` row whose coverage includes `request`'s
 * location (Э3, Арх §9) and whose adapter `supports()` it (Э4, Арх §10), each wrapped into a
 * `VesselSourceAdapter`. `request` is optional so a caller with no criteria in hand yet — or a
 * future batch/cron context — never excludes anything, same as a source with no coverage rows
 * configured.
 */
export async function listExternalAdapters(request?: SearchCriteria): Promise<ExternalAdapterList> {
  const { sources, covered } = await eligibleSources(request);

  const adapters = covered
    .map((source) => (ADAPTER_FACTORIES_BY_DOMAIN[source.domain] ?? createGenericAdapter)(source))
    .filter((adapter) => adapter.supports(request ?? emptyCriteria));

  return { adapters, skippedByCoverage: sources.length - covered.length };
}

/**
 * Same eligibility rule as `listExternalAdapters`, but keyed by `search_sources.id` (the real UUID)
 * rather than `VesselSourceAdapter.sourceId` (a human-readable string like `"brilions"` or
 * `"generic:example.com"`, unique among adapters but unrelated to the registry's own primary key).
 * Э6's candidate phase needs the UUID to restrict `external_vessel_index.source_id`; its
 * verification phase needs to go back from a candidate row's `source_id` to the adapter that can
 * actually call `checkAvailability` on it — neither works off the string id.
 */
export async function listExternalAdaptersById(
  request?: SearchCriteria,
): Promise<{ byId: Map<string, VesselSourceAdapter>; skippedByCoverage: number }> {
  const { sources, covered } = await eligibleSources(request);

  const byId = new Map<string, VesselSourceAdapter>();
  for (const source of covered) {
    const adapter = (ADAPTER_FACTORIES_BY_DOMAIN[source.domain] ?? createGenericAdapter)(source);
    if (adapter.supports(request ?? emptyCriteria)) byId.set(source.id, adapter);
  }

  return { byId, skippedByCoverage: sources.length - covered.length };
}

/**
 * The internal catalogue plus every eligible external adapter, as one uniform list — Э4's own
 * "Готово когда" ("оркестратор работает через единый список адаптеров, включая внутренний").
 * `orchestrator/search-orchestrator.ts`'s two-phase split still consults `internalAdapter` and
 * `listExternalAdapters` separately rather than through this: BRD §8's ≤1s internal-search budget is
 * exactly why that split exists (see its own module doc comment), and unifying the two phases'
 * *timing* is Э6's job, not Э4's — this function exists for a caller that only needs the uniform
 * list, not the latency split.
 */
export async function listSearchAdapters(request?: SearchCriteria): Promise<VesselSourceAdapter[]> {
  const { adapters } = await listExternalAdapters(request);
  return [internalAdapter, ...adapters];
}
