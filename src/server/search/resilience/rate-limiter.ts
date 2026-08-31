import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Э8 (docs/AI_Federated_Search_Migration_Plan_v1.md §6, Арх §22): one rate limiter, shared between
 * the background indexer (`index/indexer.ts`, `index/brilions-indexer.ts`) and live verification
 * (`orchestrator/verification-phase.ts`) — replaces each caller computing its own `1000 / rps` delay
 * and `sleep`-ing between iterations, which only ever paced a single sequential loop and had no way
 * to coordinate with a second, concurrent caller hitting the same source (exactly what Phase 2's
 * concurrent `checkAvailability` calls are).
 *
 * `lastCallAt` is an in-memory `Map`, best-effort only within one warm serverless instance — Fluid
 * Compute can and does serve concurrent requests through the same process (this session's own
 * platform notes), which is what makes this worth having at all, but a second, cold instance (or a
 * genuinely separate deployment) keeps its own independent map. That is an honest limitation, not a
 * bug: true cross-instance pacing would need a DB- or Redis-backed token bucket, which nothing about
 * this project's current traffic volume (a handful of registered sources, indexed roughly daily)
 * justifies yet.
 *
 * `throttle` is safe to call concurrently for the same `sourceId` — both `verification-phase.ts`'s
 * `mapWithConcurrency` and the indexer's own batch-concurrent processing (manual testing's
 * speed-up request, `index/indexer.ts`/`index/brilions-indexer.ts`) do exactly that. See
 * `reservationChains` below for how that's kept correct.
 */

/** Politeness floor when a source's `rate_limit_policy` states no `requestsPerSecond` (or an
 *  invalid one) — one request per second is a conservative default for a site that has said nothing
 *  about what it can tolerate. */
const DEFAULT_REQUESTS_PER_SECOND = 1;

const lastCallAt = new Map<string, number>();

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Per-`sourceId` promise chain — the actual serialization mechanism behind `throttle`'s
 * concurrency-safety. Without this, two concurrent callers for the same source could both read the
 * same `lastCallAt` value (there's an `await` — `getRequestsPerSecond` — between the read and the
 * write below) and both proceed at once, bursting past the configured `requestsPerSecond` instead of
 * spacing out. Chaining each call's slot-reservation after the previous one's means only one
 * reservation is ever in flight per source, while everything a caller does *after* `throttle`
 * resolves (fetch, extraction, DB writes) still runs fully concurrently with other callers' own
 * post-throttle work — this only serializes the "claim a paced slot" moment itself.
 */
const reservationChains = new Map<string, Promise<unknown>>();

async function reserveSlot(sourceId: string, minIntervalMs: number): Promise<void> {
  const last = lastCallAt.get(sourceId);
  const now = Date.now();
  if (last !== undefined) {
    const wait = last + minIntervalMs - now;
    if (wait > 0) await sleep(wait);
  }
  lastCallAt.set(sourceId, Date.now());
}

/** `rate_limit_policy` has no fixed shape yet (Э3's admin form accepts arbitrary JSON under this
 *  key) — `requestsPerSecond` is this module's own reading of it, the first concrete convention
 *  given to an otherwise-freeform field. An admin can already set it today via the policies
 *  textarea. */
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

/**
 * Waits, if necessary, so that this call and the previous recorded call to the same `sourceId` are
 * spaced at least `1000 / requestsPerSecond` ms apart — then records this call's timestamp. Callers
 * await this immediately before the paced operation itself (a page fetch, a `checkAvailability`
 * call), unconditionally — the very first call for a source has nothing recorded yet and returns
 * immediately, so there is no special-case needed for "don't wait before the first request" the way
 * the old per-loop `if (index > 0)` guard needed.
 */
export async function throttle(sourceId: string): Promise<void> {
  const requestsPerSecond = await getRequestsPerSecond(sourceId);
  const minIntervalMs = 1000 / requestsPerSecond;

  // Chain onto this source's own queue so concurrent callers each get a distinct, correctly-spaced
  // slot instead of racing on `lastCallAt` — see `reservationChains`'s own doc comment. The second
  // `.then` handler covers a previous link that itself rejected (shouldn't happen — `reserveSlot`
  // has nothing that throws — but a broken chain must never wedge every future call to this source).
  const previous = reservationChains.get(sourceId) ?? Promise.resolve();
  const mine = previous.then(
    () => reserveSlot(sourceId, minIntervalMs),
    () => reserveSlot(sourceId, minIntervalMs),
  );
  reservationChains.set(sourceId, mine);
  await mine;
}
