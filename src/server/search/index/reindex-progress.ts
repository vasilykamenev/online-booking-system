import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

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
      })
      .eq("id", sourceId);
  } catch {
    // best-effort — see module doc comment
  }
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
