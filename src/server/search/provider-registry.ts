import "server-only";
import { brilionsProvider } from "@/server/search/providers/brilions/provider";
import { createGenericProvider } from "@/server/search/providers/generic/provider";
import { listEnabledSources } from "@/server/search/source-registry";
import type { ExternalSearchProvider } from "@/server/search/providers";

/**
 * Every purpose-built `ExternalSearchProvider`, keyed by the domain its `search_sources` row uses.
 * A domain listed here always wins over the generic fallback below — hand-tuned selectors beat a
 * site-agnostic guess whenever someone has actually written them.
 */
const PROVIDERS_BY_DOMAIN: Record<string, ExternalSearchProvider> = {
  "brilions.com": brilionsProvider,
};

/** `processingType`s the generic provider (`providers/generic/provider.ts`) can actually attempt —
 *  HTML is deliberately excluded: without site-specific selectors there's nothing for it to read
 *  deterministically, so a source stuck on HTML with no purpose-built provider genuinely needs one
 *  written, same as before. */
const GENERIC_PROCESSING_TYPES = new Set(["AI_EXTRACTION", "STRUCTURED_DATA"]);

/**
 * Providers to consult for a search: every `search_sources` row that is currently `enabled` and
 * `status = 'active'` (spec §8/§9's registry). A domain with a purpose-built provider in
 * `PROVIDERS_BY_DOMAIN` gets it; any other row whose `processingType` the generic provider can
 * attempt gets `createGenericProvider` instead — this is what makes approving a brand-new source in
 * `/admin/search-sources` searchable immediately, with no provider code or deploy required. A row
 * stuck on `HTML` with no purpose-built provider still needs one written (see
 * `providers/generic/provider.ts`'s module doc for why HTML can't be attempted generically).
 */
export async function getActiveExternalProviders(): Promise<ExternalSearchProvider[]> {
  const sources = await listEnabledSources();

  return sources
    .map((source): ExternalSearchProvider | null => {
      const specific = PROVIDERS_BY_DOMAIN[source.domain];
      if (specific) return specific;
      if (GENERIC_PROCESSING_TYPES.has(source.processingType)) return createGenericProvider(source);
      return null;
    })
    .filter((provider): provider is ExternalSearchProvider => provider !== null);
}
