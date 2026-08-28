import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Pieces `index/indexer.ts` (generic-tier indexing) and `index/brilions-indexer.ts` (brilions'
 * bespoke sitemap-and-extractor indexing) both need — kept in their own module rather than one
 * importing from the other, since `indexer.ts`'s public `indexSource` dispatcher imports
 * `indexBrilionsSource` and would otherwise create a cycle.
 */

export interface IndexRunResult {
  sourceId: string;
  urlsConsidered: number;
  pagesFetched: number;
  pagesFailed: number;
  pagesUnchanged: number;
  listingsIndexed: number;
  aiCalls: number;
}

export const emptyRunResult = (sourceId: string): IndexRunResult => ({
  sourceId,
  urlsConsidered: 0,
  pagesFetched: 0,
  pagesFailed: 0,
  pagesUnchanged: 0,
  listingsIndexed: 0,
  aiCalls: 0,
});

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Politeness floor when a source's `search_source_policies.rate_limit_policy` states no
 *  `requestsPerSecond` (or an invalid one) — one request per second is a conservative default for a
 *  site that has said nothing about what it can tolerate. */
const DEFAULT_REQUESTS_PER_SECOND = 1;

/** `rate_limit_policy` has no fixed shape yet (Э3's admin form accepts arbitrary JSON under this
 *  key) — `requestsPerSecond` is this module's own reading of it, the first concrete convention
 *  given to an otherwise-freeform field. An admin can already set it today via the policies
 *  textarea; nothing else currently reads any other key there. */
export async function getRequestsPerSecond(sourceId: string): Promise<number> {
  const { data } = await createAdminClient()
    .from("search_source_policies")
    .select("rate_limit_policy")
    .eq("source_id", sourceId)
    .maybeSingle();
  const policy = data?.rate_limit_policy as { requestsPerSecond?: unknown } | null;
  const value = typeof policy?.requestsPerSecond === "number" ? policy.requestsPerSecond : null;
  return value && value > 0 ? value : DEFAULT_REQUESTS_PER_SECOND;
}
