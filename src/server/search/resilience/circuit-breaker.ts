/**
 * Э8 (docs/AI_Federated_Search_Migration_Plan_v1.md §6, Арх §22, §23): the closed → open → half-open
 * state machine, as pure functions — `resilience/source-health.ts` is the only thing that reads or
 * writes `search_source_health`; this module never touches the database, so every transition is
 * directly testable without one.
 *
 * "Open" means what Арх §23 says it should: **we stop calling this source**, not **the search
 * fails**. A caller that finds the breaker open never throws or bubbles an error — it falls back to
 * whatever it already has (the index, for search; nothing new to report, for the indexer's own next
 * scheduled run) exactly the same way a source with zero coverage or an ineligible adapter already
 * degrades (`adapter-registry.ts`'s `skippedByCoverage`, `supports()`).
 */

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerPolicy {
  /** Consecutive failures before the breaker trips OPEN. */
  failureThreshold: number;
  /** How long OPEN lasts before a call is allowed through again as a HALF_OPEN trial. */
  cooldownMs: number;
}

/** Five in a row is enough to say "this isn't a blip" without being trigger-happy on a source that
 *  just had one bad page; fifteen minutes is long enough to stop hammering a struggling site but
 *  short enough that a real outage doesn't silently starve the index for hours. Neither number is
 *  tuned against real failure data yet — same caveat this codebase already gives its other
 *  first-approximation constants (e.g. `index-retention.ts`'s `INDEX_RETENTION_MS`). */
export const DEFAULT_CIRCUIT_BREAKER_POLICY: CircuitBreakerPolicy = {
  failureThreshold: 5,
  cooldownMs: 15 * 60 * 1000,
};

export interface CircuitSnapshot {
  state: CircuitState;
  consecutiveFailures: number;
  /** ISO timestamp of the last OPEN transition, `null` while CLOSED. */
  openedAt: string | null;
}

export const CLOSED_SNAPSHOT: CircuitSnapshot = { state: "CLOSED", consecutiveFailures: 0, openedAt: null };

/**
 * Whether a call should be attempted right now. CLOSED and HALF_OPEN both allow it — HALF_OPEN *is*
 * the trial call an elapsed cooldown earns. OPEN allows it only once `cooldownMs` has actually
 * elapsed since `openedAt`, at which point the caller is effectively attempting the HALF_OPEN trial
 * (see `source-health.ts`'s `isSourceCallAllowed` for where that gets persisted).
 *
 * Deliberately doesn't guard against more than one concurrent caller both seeing "cooldown elapsed"
 * and rushing in at once (a proper single-flight trial would need a lock) — at today's call volume
 * (a handful of sources, checked at most a few dozen times per search) that's a cosmetic
 * imprecision, not a correctness problem: a second trial call either also succeeds (fine, the
 * breaker still closes) or also fails (fine, `afterFailure` below re-opens it either way).
 */
export function isCallAllowed(snapshot: CircuitSnapshot, policy: CircuitBreakerPolicy, now: number): boolean {
  if (snapshot.state !== "OPEN") return true;
  if (snapshot.openedAt === null) return true; // malformed state — fail open rather than wedge shut
  return now - Date.parse(snapshot.openedAt) >= policy.cooldownMs;
}

/** A success — live or from the indexer — always fully closes the breaker, whether it came from
 *  CLOSED (nothing changes), HALF_OPEN (the trial worked), or, in principle, OPEN (an out-of-band
 *  success some other path recorded). Standard circuit-breaker semantics: one good call is enough to
 *  trust the source again. */
export function afterSuccess(): CircuitSnapshot {
  return CLOSED_SNAPSHOT;
}

/**
 * A failure — from CLOSED, only trips OPEN once `failureThreshold` consecutive failures accumulate
 * (a single bad page must not disable a whole source). From HALF_OPEN (the trial call itself
 * failed) or OPEN, it re-opens immediately with a fresh `openedAt`, restarting the cooldown — the
 * source hasn't earned trust back.
 */
export function afterFailure(snapshot: CircuitSnapshot, policy: CircuitBreakerPolicy, now: number): CircuitSnapshot {
  const consecutiveFailures = snapshot.consecutiveFailures + 1;
  const nowIso = new Date(now).toISOString();

  if (snapshot.state !== "CLOSED") {
    return { state: "OPEN", consecutiveFailures, openedAt: nowIso };
  }
  if (consecutiveFailures >= policy.failureThreshold) {
    return { state: "OPEN", consecutiveFailures, openedAt: nowIso };
  }
  return { state: "CLOSED", consecutiveFailures, openedAt: null };
}
