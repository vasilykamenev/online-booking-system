import "server-only";
import { brilionsProvider } from "@/server/search/providers/brilions/provider";
import { listEnabledSources } from "@/server/search/source-registry";
import type { ExternalSearchProvider } from "@/server/search/providers";

/**
 * Every implemented `ExternalSearchProvider`, keyed by the domain its `search_sources` row uses.
 * Adding a row to the registry via `/admin/search-sources` is not enough to start crawling a site
 * (the admin page's `wiringHint` says as much) — a provider implementation has to exist and be
 * registered here too. This map is that registration point.
 */
const PROVIDERS_BY_DOMAIN: Record<string, ExternalSearchProvider> = {
  "brilions.com": brilionsProvider,
};

/**
 * Providers to consult for a search: every implemented provider whose `search_sources` row is
 * currently enabled. This is what makes the admin page's enable/disable toggle take effect end to
 * end — disabling a source here removes it from search entirely, not just from the ranking bonus
 * `getSourceReliability` already reads from the same registry.
 */
export async function getActiveExternalProviders(): Promise<ExternalSearchProvider[]> {
  const enabledDomains = new Set((await listEnabledSources()).map((source) => source.domain));
  return Object.entries(PROVIDERS_BY_DOMAIN)
    .filter(([domain]) => enabledDomains.has(domain))
    .map(([, provider]) => provider);
}
