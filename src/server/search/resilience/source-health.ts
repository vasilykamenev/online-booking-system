import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  afterFailure,
  afterSuccess,
  isCallAllowed,
  CLOSED_SNAPSHOT,
  DEFAULT_CIRCUIT_BREAKER_POLICY,
  type CircuitBreakerPolicy,
  type CircuitSnapshot,
} from "@/server/search/resilience/circuit-breaker";

/**
 * I/O wrapper around `circuit-breaker.ts` (Э8) — reads/writes `search_source_health`, same
 * service-role-client convention as every other write on the search side (`recordExtraction`,
 * `recordFetchOutcome`): both the indexer and live verification run for anonymous traffic too.
 */

/** `rate_limit_policy` again (Э5's convention, extended here) — a `circuitBreaker` sub-object rather
 *  than a new top-level `search_source_policies` column: both fields describe "how cautiously do we
 *  treat this source", and the column is already freeform JSON with exactly one admin-facing reader
 *  (the policies textarea), so a new key costs nothing a new column wouldn't also cost, without a
 *  migration. */
export async function getCircuitBreakerPolicy(sourceId: string): Promise<CircuitBreakerPolicy> {
  const { data } = await createAdminClient()
    .from("search_source_policies")
    .select("rate_limit_policy")
    .eq("source_id", sourceId)
    .maybeSingle();
  const policy = data?.rate_limit_policy as { circuitBreaker?: { failureThreshold?: unknown; cooldownMs?: unknown } } | null;
  const raw = policy?.circuitBreaker;

  const failureThreshold =
    typeof raw?.failureThreshold === "number" && raw.failureThreshold > 0
      ? raw.failureThreshold
      : DEFAULT_CIRCUIT_BREAKER_POLICY.failureThreshold;
  const cooldownMs =
    typeof raw?.cooldownMs === "number" && raw.cooldownMs > 0 ? raw.cooldownMs : DEFAULT_CIRCUIT_BREAKER_POLICY.cooldownMs;

  return { failureThreshold, cooldownMs };
}

/** No row yet reads identically to an explicit CLOSED/0-failures one — a source that has never had
 *  an outcome recorded has, by definition, no failures to speak of. */
export async function getSourceHealth(sourceId: string): Promise<CircuitSnapshot> {
  const { data } = await createAdminClient()
    .from("search_source_health")
    .select("state, consecutive_failures, opened_at")
    .eq("source_id", sourceId)
    .maybeSingle();
  if (!data) return CLOSED_SNAPSHOT;
  return { state: data.state, consecutiveFailures: data.consecutive_failures, openedAt: data.opened_at };
}

async function upsertHealth(
  sourceId: string,
  snapshot: CircuitSnapshot,
  extra: { lastSuccessAt?: string; lastFailureAt?: string; lastError?: string },
): Promise<void> {
  await createAdminClient()
    .from("search_source_health")
    .upsert(
      {
        source_id: sourceId,
        state: snapshot.state,
        consecutive_failures: snapshot.consecutiveFailures,
        opened_at: snapshot.openedAt,
        ...(extra.lastSuccessAt ? { last_success_at: extra.lastSuccessAt } : {}),
        ...(extra.lastFailureAt ? { last_failure_at: extra.lastFailureAt } : {}),
        ...(extra.lastError !== undefined ? { last_error: extra.lastError } : {}),
      },
      { onConflict: "source_id" },
    );
}

/**
 * Whether a call to this source should be attempted right now — the one thing every caller
 * (indexer, live verification) checks before doing any actual work. Best-effort: a read failure
 * degrades to "allowed" (fail open, same discipline `isCallAllowed`'s own doc comment already
 * applies to a malformed snapshot) rather than blocking a source over an unrelated DB hiccup.
 */
export async function isSourceCallAllowed(sourceId: string): Promise<boolean> {
  try {
    const [snapshot, policy] = await Promise.all([getSourceHealth(sourceId), getCircuitBreakerPolicy(sourceId)]);
    return isCallAllowed(snapshot, policy, Date.now());
  } catch {
    return true;
  }
}

/** Never throws — telemetry must not sink the call it's describing, same convention as
 *  `recordSearchRun`. */
export async function recordSourceSuccess(sourceId: string): Promise<void> {
  try {
    await upsertHealth(sourceId, afterSuccess(), { lastSuccessAt: new Date().toISOString() });
  } catch {
    // best-effort
  }
}

export async function recordSourceFailure(sourceId: string, error: string): Promise<void> {
  try {
    const [snapshot, policy] = await Promise.all([getSourceHealth(sourceId), getCircuitBreakerPolicy(sourceId)]);
    const now = Date.now();
    await upsertHealth(sourceId, afterFailure(snapshot, policy, now), {
      lastFailureAt: new Date(now).toISOString(),
      lastError: error,
    });
  } catch {
    // best-effort
  }
}
