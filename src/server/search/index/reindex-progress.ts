import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { REINDEX_ASSUMED_TIMEOUT_MS } from "@/lib/search/reindex-timing";

/**
 * Live progress for one source's currently-running (or last) indexing pass — lets the admin UI show
 * a percentage/count instead of only a before/after result once `reindexSearchSource` returns
 * (Э5's "Индексировать сейчас" button, a blank wait for minutes on a large source like sailica.com's
 * ~2000 catalog pages otherwise). Written from inside `indexGenericSource`/`indexBrilionsSource`'s
 * own batch loop, which already knows the total upfront and walks it `concurrency` candidates at a
 * time (manual testing's speed-up request).
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
        // Likewise a stale reason from whatever stopped the *previous* run — irrelevant to this one
        // until it stops too.
        last_stop_reason: null,
      })
      .eq("id", sourceId);
  } catch {
    // best-effort — see module doc comment
  }
}

/** Checked once per batch by both indexers, before dispatching it (never mid-batch — see each
 *  indexer's own batch loop for why) — cheap relative to a whole batch of fetches, and failing safe
 *  to `false` means a transient DB hiccup never mistakenly aborts a run that wasn't actually asked to
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

/** Terminal write for a run stopped between batches — `processed` is the caller's own batch-boundary
 *  position (every page up to here is genuinely done). Resets `reindex_cancel_requested`: it has now
 *  been acted on either way. `reason` records *why* — `"cancelled"` for the admin's manual "Остановить"
 *  (`isCancelRequested`), `"deadline"` for the run's own `reindex_max_duration_seconds` budget — so
 *  the admin UI's auto-resume (manual testing's "keep scanning until 100% while the tab is open"
 *  request) can tell them apart: it should pick a `"deadline"` stop back up on its own, but must never
 *  override an admin's explicit `"cancelled"` Stop. */
export async function cancelReindexProgress(
  sourceId: string,
  processed: number,
  reason: "cancelled" | "deadline",
): Promise<void> {
  try {
    await createAdminClient()
      .from("search_sources")
      .update({
        reindex_finished_at: new Date().toISOString(),
        reindex_processed: processed,
        reindex_cancel_requested: false,
        last_stop_reason: reason,
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
        last_stop_reason: null,
      })
      .eq("id", sourceId);
  } catch {
    // best-effort — see module doc comment
  }

  return { startFrom: processed, total };
}

/** Called once per completed batch (manual testing's concurrency speed-up), not once per page —
 *  the batch size itself is now the natural write-frequency throttle a stride constant used to
 *  provide for the old one-page-at-a-time loop, so every call here writes unconditionally. */
export async function bumpReindexProgress(sourceId: string, processed: number): Promise<void> {
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
      .update({
        reindex_finished_at: new Date().toISOString(),
        reindex_processed: processed,
        last_stop_reason: null,
      })
      .eq("id", sourceId);
  } catch {
    // best-effort — see module doc comment
  }
}

/**
 * Cron's per-tick decision for one source: fresh full pass, resume from where a previous run left
 * off, or skip this tick entirely. Distinct from `beginResume` (which only answers "is there a
 * genuinely resumable incomplete run" for the admin's manual "Продолжить") — cron additionally needs
 * "never run before" and "fully completed last time" to both mean *fresh*, not "nothing to resume",
 * since a daily reindex must keep re-walking a finished catalog, not stop forever once it once hit
 * 100%.
 */
export async function resolveCronStartFrom(sourceId: string): Promise<{ startFrom: number } | null> {
  const { data } = await createAdminClient()
    .from("search_sources")
    .select("reindex_total, reindex_processed")
    .eq("id", sourceId)
    .maybeSingle();

  const total = data?.reindex_total ?? null;
  const processed = data?.reindex_processed ?? null;
  if (total === null || processed === null || processed >= total) {
    return { startFrom: 0 }; // never run, or fully completed last time
  }

  const resumed = await beginResume(sourceId);
  return resumed ? { startFrom: resumed.startFrom } : null; // null: looks genuinely still running
}

/** Set only by a genuine reject inside `indexSource` during a cron run (`index-sources/route.ts`) —
 *  never by a clean stop (deadline/manual Stop, both ordinary results, not exceptions). Best-effort,
 *  mirrors this module's other writes. */
export async function recordCronError(sourceId: string, message: string): Promise<void> {
  try {
    await createAdminClient()
      .from("search_sources")
      .update({ last_cron_error: message, last_cron_error_at: new Date().toISOString() })
      .eq("id", sourceId);
  } catch {
    // best-effort — see module doc comment
  }
}

/** Cleared on any cron run that completes without throwing, regardless of whether it fully finished,
 *  was cancelled, or hit its own deadline — none of those are errors, only an actual reject is. */
export async function clearCronError(sourceId: string): Promise<void> {
  try {
    await createAdminClient()
      .from("search_sources")
      .update({ last_cron_error: null, last_cron_error_at: null })
      .eq("id", sourceId);
  } catch {
    // best-effort — see module doc comment
  }
}
