import "server-only";
import { brilionsProvider } from "@/server/search/providers/brilions/provider";
import { createGenericProvider } from "@/server/search/providers/generic/provider";
import { listEnabledSources, type SearchSource } from "@/server/search/source-registry";
import { sourceCovers } from "@/server/search/coverage";
import type { ExternalSearchProvider } from "@/server/search/providers";
import type { SearchCriteria } from "@/lib/search/request";

/**
 * Every purpose-built `ExternalSearchProvider`, keyed by the domain its `search_sources` row uses.
 * A domain listed here always wins over the generic fallback below — hand-tuned selectors beat a
 * site-agnostic guess whenever someone has actually written them.
 */
const PROVIDERS_BY_DOMAIN: Record<string, ExternalSearchProvider> = {
  "brilions.com": brilionsProvider,
};

/**
 * Whether the generic provider (`providers/generic/provider.ts`) can attempt this source's declared
 * `processingType` with no purpose-built code. `AI_EXTRACTION`/`STRUCTURED_DATA` need nothing extra
 * — the generic provider's JSON-LD-then-AI path already covers both identically. `HTML`/`HYBRID`
 * need a `selectorConfig` (docs/search-source-processing-strategies.md §1.1): without site-specific
 * selectors there's nothing for a generic pass to read deterministically, so a source stuck on those
 * two with no config (and no purpose-built provider) genuinely still needs one written, same as
 * `API` — deliberately never generalized here, since auth/pagination vary too much between APIs to
 * guess at from zero real examples.
 */
function isGenericEligible(source: SearchSource): boolean {
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
}

export interface ActiveExternalProviders {
  providers: ExternalSearchProvider[];
  /** Э3 (Арх §9): enabled sources this search never consulted because their coverage doesn't include
   *  the request's location — surfaced separately from `providers.length` so a source excluded for
   *  not covering the place asked about is distinguishable in `search_runs` from one simply not
   *  wired to any provider yet (see `isGenericEligible`). */
  skippedByCoverage: number;
}

/**
 * Providers to consult for a search: every `search_sources` row that is currently `enabled`,
 * `status = 'active'` (spec §8/§9's registry) and whose coverage includes `request`'s location
 * (Арх §9 — checked before a source is ever consulted, not after). A domain with a purpose-built
 * provider in `PROVIDERS_BY_DOMAIN` gets it, regardless of its declared `processingType`; any other
 * row `isGenericEligible` for gets `createGenericProvider` instead — this is what makes approving a
 * brand-new source in `/admin/search-sources` searchable immediately, with no provider code or
 * deploy required, for `AI_EXTRACTION`/`STRUCTURED_DATA` always and for `HTML`/`HYBRID` once an
 * admin has filled in `selectorConfig`.
 *
 * `request` is optional so existing callers with no criteria in hand yet (or a future batch/cron
 * context) keep working — omitting it never excludes anything, same as a source with no coverage
 * rows configured (see `coverage.ts`'s `sourceCovers`).
 */
export async function getActiveExternalProviders(
  request?: SearchCriteria,
): Promise<ActiveExternalProviders> {
  const sources = await listEnabledSources();
  const covered = request ? sources.filter((source) => sourceCovers(source.coverage, request)) : sources;

  const providers = covered
    .map((source): ExternalSearchProvider | null => {
      const specific = PROVIDERS_BY_DOMAIN[source.domain];
      if (specific) return specific;
      if (isGenericEligible(source)) return createGenericProvider(source);
      return null;
    })
    .filter((provider): provider is ExternalSearchProvider => provider !== null);

  return { providers, skippedByCoverage: sources.length - covered.length };
}
