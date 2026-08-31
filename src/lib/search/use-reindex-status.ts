"use client";

import { useEffect, useState } from "react";
import { fetchReindexProgress, type FetchReindexProgressResult } from "@/server/actions/admin";
import { REINDEX_ASSUMED_TIMEOUT_MS } from "@/lib/search/reindex-timing";

/** Frequent enough to feel live without hammering the DB on an admin-only, low-traffic page — same
 *  interval `ReindexProgressIndicator` already polled at before this hook replaced its inline copy. */
const POLL_INTERVAL_MS = 3000;

export interface ReindexStatus {
  progress: FetchReindexProgressResult | null;
  /** A start with no finish yet, and not old enough to presume dead (see `REINDEX_ASSUMED_TIMEOUT_MS`). */
  isRunning: boolean;
  /** Stopped (Stop click) or presumed timed out, with pages left to go — `resumeSearchSourceIndexing`
   *  has something to work with. Never true while `isRunning` is. */
  canResume: boolean;
  /** `canResume`, narrowed to runs that stopped themselves by hitting `reindex_max_duration_seconds`
   *  — never true for a run the admin explicitly clicked "Остановить" on (`stopReason ===
   *  "cancelled"`), nor for one presumed-timed-out with no recorded reason at all (an older/edge-case
   *  row predating this field, or a genuinely still-running one this hook can't yet tell apart —
   *  safer to require an explicit "deadline" than to auto-resume something merely presumed stale).
   *  Drives `ReindexButton`'s auto-resume (manual testing's "keep scanning until 100% while the tab
   *  is open" request). */
  canAutoResume: boolean;
  percent: number;
}

/**
 * Single poll + derivation shared by `ReindexButton` (which buttons to show) and
 * `ReindexProgressIndicator` (what to render) — factored out once Resume/Stop added a second,
 * easy-to-drift-apart consumer of the same "running vs. stale vs. resumable" logic that used to live
 * only, inline, in the indicator.
 */
export function useReindexStatus(sourceId: string): ReindexStatus {
  // `checkedAt` is captured once per poll tick (inside the effect below), not read live during
  // render (`Date.now()` in a component body is an impure call React's purity rule rejects) — a
  // fixed-at-poll-time "now" is exactly what "does this look stale" should compare against anyway.
  const [state, setState] = useState<{ progress: FetchReindexProgressResult | null; checkedAt: number }>({
    progress: null,
    checkedAt: 0,
  });

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      const result = await fetchReindexProgress(sourceId);
      if (!cancelled) setState({ progress: result, checkedAt: Date.now() });
    }

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [sourceId]);

  const { progress, checkedAt } = state;

  if (!progress || progress.error || !progress.startedAt) {
    return { progress, isRunning: false, canResume: false, canAutoResume: false, percent: 0 };
  }

  const startedAt = new Date(progress.startedAt).getTime();
  const finishedAt = progress.finishedAt ? new Date(progress.finishedAt).getTime() : null;
  const total = progress.total ?? 0;
  const processed = progress.processed ?? 0;

  // Same "last start beats last finish" comparison the reindex_progress migration's own doc comment
  // describes — a finish from a previous run must never be read as "this run is done".
  const isFinished = finishedAt !== null && finishedAt >= startedAt;
  const isStale = !isFinished && checkedAt - startedAt > REINDEX_ASSUMED_TIMEOUT_MS;
  const isRunning = !isFinished && !isStale;
  const canResume = !isRunning && total > 0 && processed < total;
  const canAutoResume = canResume && progress.stopReason === "deadline";
  const percent = total > 0 ? Math.round((processed / total) * 100) : 0;

  return { progress, isRunning, canResume, canAutoResume, percent };
}
