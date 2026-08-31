import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { REINDEX_ASSUMED_TIMEOUT_MS } from "@/lib/search/reindex-timing";

/**
 * Live progress for one source's currently-running (or last) indexing pass — lets the admin UI show
 * a percentage/count instead of only a before/after result once `reindexSearchSource` returns
 * (Э5's "Индексировать сейчас" button, a blank wait for minutes on a large source like sailica.com's
 * ~2000 catalog pages otherwise). Written from inside `indexGenericSource`/`indexBrilionsSource`'s
 * own per-candidate loop, which already knows the total upfront and walks it one page at a time.
 *
 * Best-effort throughout, same "telemetry doesn't sink the call it's describing" discipline as
 * `source-structure-health.ts`'s checker — a progress-write failure must never fail or slow the
 * indexing run it's reporting on, so every export here swallows its own errors.
 *
 * `reindex_cancel_requested`/`isCancelRequested`/`cancelReindexProgress`/`beginResume` (manual
 * testing's Resume/Stop, see plan) are the one exception to "best-effort telemetry": a cancel flag
 * is a command, not an observation, so `isCancelRequested` failing safe to `false` (never sinking the
 * run) matters, but it is still consulted for real control flow by the indexer loops, not just
 * displayed. There is deliberately no stored "status" column — same reasoning the original migration
 * gives for deriving "running" from `started_at`/`finished_at` rather than a flag that could go
 * stale: "cancelled, resumable" is `finished_at` set with `processed < total`, "completed" is
 * `processed === total`, both already expressible with the four columns that existed before this.
 */

/** Every single processed item would mean one `UPDATE` per page — fine for correctness, wasteful at
 *  sailica.com's scale. `bumpReindexProgress` only writes on a multiple of this (plus whenever the
 *  caller passes `force`), same throttling reasoning as this module's siblings elsewhere in this
 *  codebase (e.g. `resilience/rate-limiter.ts`). */
const PROGRESS_WRITE_STRIDE = 10;

export async function startReindexProgress(sourceId: string, total: number): Promise<void> {
  try {
    await createAdminClient()
      .from("search_sources")
      .update({
        reindex_started_at: new Date().toISOString(),
        reindex_finished_at: null,
        reindex_total: total,
        reindex_processed: 0,
        // A stale request from a previous run's Stop click (or a race between Stop and the run's own
        // natural finish) must never bleed into a brand-new run — a fresh start always begins
        // un-cancelled.
        reindex_cancel_requested: false,
      })
      .eq("id", sourceId);
  } catch {
    // best-effort — see module doc comment
  }
}

/** Polled once per loop iteration by both indexers, before the paced network fetch — cheap relative
 *  to everything else an iteration already does (see plan's "Stop" semantics), and failing safe to
 *  `false` means a transient DB hiccup never mistakenly aborts a run that wasn't actually asked to
 *  stop. */
export async function isCancelRequested(sourceId: string): Promise<boolean> {
  try {
    const { data } = await createAdminClient()
      .from("search_sources")
      .select("reindex_cancel_requested")
      .eq("id", sourceId)
      .maybeSingle();
    return data?.reindex_cancel_requested ?? false;
  } catch {
    return false;
  }
}

/** Terminal write for a run stopped mid-way by `isCancelRequested` — `processed` is the caller's own
 *  loop position, written unconditionally (unlike `bumpReindexProgress`'s throttled stride) since
 *  this is the run's last write. Resets the flag: it has now been acted on. */
export async function cancelReindexProgress(sourceId: string, processed: number): Promise<void> {
  try {
    await createAdminClient()
      .from("search_sources")
      .update({
        reindex_finished_at: new Date().toISOString(),
        reindex_processed: processed,
        reindex_cancel_requested: false,
      })
      .eq("id", sourceId);
  } catch {
    // best-effort — see module doc comment
  }
}

/**
 * Fast, synchronous-safe setup for a "Продолжить" (Resume) click — called directly from the Server
 * Action (not inside `after()`), so the admin gets an immediate error rather than a silent no-op if
 * there's nothing to resume. Returns `null` when: the run already completed (`processed >= total`),
 * there's no prior run at all, or the existing run still looks genuinely in flight (no `finished_at`
 * and `started_at` newer than `REINDEX_ASSUMED_TIMEOUT_MS`) — that last check is what stops a Resume
 * click from racing a second crawl loop against one that (as far as this row can tell) might still be
 * running.
 */
export async function beginResume(sourceId: string): Promise<{ startFrom: number; total: number } | null> {
  const { data } = await createAdminClient()
    .from("search_sources")
    .select("reindex_started_at, reindex_finished_at, reindex_total, reindex_processed")
    .eq("id", sourceId)
    .maybeSingle();
  if (!data || data.reindex_total == null || data.reindex_processed == null) return null;

  const total = data.reindex_total;
  const processed = data.reindex_processed;
  if (processed >= total) return null; // already completed — nothing to resume

  const startedAt = data.reindex_started_at ? new Date(data.reindex_started_at).getTime() : null;
  const isFinished = data.reindex_finished_at !== null;
  const isStale = !isFinished && startedAt !== null && Date.now() - startedAt > REINDEX_ASSUMED_TIMEOUT_MS;
  if (!isFinished && !isStale) return null; // looks like it might still genuinely be running

  try {
    await createAdminClient()
      .from("search_sources")
      .update({
        reindex_started_at: new Date().toISOString(),
        reindex_finished_at: null,
        reindex_cancel_requested: false,
      })
      .eq("id", sourceId);
  } catch {
    // best-effort — see module doc comment
  }

  return { startFrom: processed, total };
}

/** `force` bypasses the write-stride throttle — pass it for the very last item so a run's own final
 *  count is always visible immediately, not up to `PROGRESS_WRITE_STRIDE - 1` items stale until
 *  `finishReindexProgress` writes anyway (harmless either way, just avoids a needlessly stale-looking
 *  progress bar right before a run ends). */
export async function bumpReindexProgress(sourceId: string, processed: number, force = false): Promise<void> {
  if (!force && processed % PROGRESS_WRITE_STRIDE !== 0) return;
  try {
    await createAdminClient().from("search_sources").update({ reindex_processed: processed }).eq("id", sourceId);
  } catch {
    // best-effort — see module doc comment
  }
}

export async function finishReindexProgress(sourceId: string, processed: number): Promise<void> {
  try {
    await createAdminClient()
      .from("search_sources")
      .update({ reindex_finished_at: new Date().toISOString(), reindex_processed: processed })
      .eq("id", sourceId);
  } catch {
    // best-effort — see module doc comment
  }
}
