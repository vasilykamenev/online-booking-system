import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Э10 (docs/AI_Federated_Search_Migration_Plan_v1.md §6, Арх §19): "детект смены структуры
 * источника — при падении доли успешных извлечений ниже порога, пометить источник и предложить
 * переанализ". Split the same way `resilience/circuit-breaker.ts`/`source-health.ts` are: the
 * threshold decision (`evaluateStructureHealth`) is a pure function, directly testable without a
 * database; `checkSourceStructureHealth` is the thin I/O wrapper that feeds it real numbers and
 * persists the verdict.
 *
 * Deliberately reads `external_vessel_index` instead of a new outcome-tracking table — the ground
 * truth of "did this page's structure still yield a name and a price" already lives there (every
 * indexer visit upserts one row via `recordExtraction`/`touchExtraction`), and a page whose selectors
 * broke after a site redesign shows up as a row with `name`/`price_minor` null the same as one that
 * was never extractable in the first place. That's exactly the signal worth alarming on: a fetch
 * that still returns 200 (so `resilience/source-health.ts`'s circuit breaker never trips) but stopped
 * yielding usable fields is otherwise invisible anywhere else in this pipeline.
 */

/** Below five recently-revisited rows, one bad page is a third of the "rate" — not a verdict about
 *  the source's structure, just noise. Matches `resilience/circuit-breaker.ts`'s own "five in a row
 *  is enough to say this isn't a blip" reasoning for the same kind of judgment call. */
export const MIN_SAMPLE_SIZE = 5;

/** Below 60% of recently-revisited pages still yielding a name and a price is treated as "the site's
 *  markup probably changed", not "this source always misses a few". Same first-approximation caveat
 *  every other untuned threshold in this codebase carries (see `circuit-breaker.ts`'s own note on
 *  `DEFAULT_CIRCUIT_BREAKER_POLICY`) — not tuned against real drift data yet. */
export const SUCCESS_RATE_THRESHOLD = 0.6;

/** Only rows the indexer has actually revisited recently count toward the rate — a row nobody's
 *  crawled in months says nothing about whether *today's* page structure still extracts cleanly, and
 *  would otherwise let a long-stale, never-refreshed source sit at whatever rate it happened to have
 *  the last time anyone looked. */
export const RECENT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export interface StructureHealthVerdict {
  sampleSize: number;
  successCount: number;
  successRate: number | null;
  needsReanalysis: boolean;
}

/**
 * Pure threshold logic — no I/O, no clock reads (the caller already resolved `sampleSize`/
 * `successCount` from a fixed time window). `sampleSize` below `MIN_SAMPLE_SIZE` never flags,
 * regardless of how bad the rate looks on that few pages.
 */
export function evaluateStructureHealth(sampleSize: number, successCount: number): StructureHealthVerdict {
  const successRate = sampleSize > 0 ? successCount / sampleSize : null;
  const needsReanalysis = sampleSize >= MIN_SAMPLE_SIZE && successRate !== null && successRate < SUCCESS_RATE_THRESHOLD;
  return { sampleSize, successCount, successRate, needsReanalysis };
}

/**
 * Recomputes and persists one source's structure-health verdict — called from `index/indexer.ts`'s
 * `indexSource` after every run (Арх §19: "AI на онбординге и при поломке, не на каждом запросе" —
 * this piggybacks on the indexer's own cadence, never on a live search request). Best-effort: a
 * failure here must never fail the indexing run it's attached to, same "telemetry doesn't sink the
 * call it's describing" discipline as `resilience/source-health.ts`'s recorders.
 */
export async function checkSourceStructureHealth(sourceId: string): Promise<StructureHealthVerdict | null> {
  try {
    const supabase = createAdminClient();
    const since = new Date(Date.now() - RECENT_WINDOW_MS).toISOString();

    const { count: total } = await supabase
      .from("external_vessel_index")
      .select("id", { count: "exact", head: true })
      .eq("source_id", sourceId)
      .gte("last_extracted_at", since);

    const { count: withFields } = await supabase
      .from("external_vessel_index")
      .select("id", { count: "exact", head: true })
      .eq("source_id", sourceId)
      .gte("last_extracted_at", since)
      .not("name", "is", null)
      .not("price_minor", "is", null);

    const verdict = evaluateStructureHealth(total ?? 0, withFields ?? 0);

    await supabase
      .from("search_sources")
      .update({
        needs_reanalysis: verdict.needsReanalysis,
        reanalysis_sample_size: verdict.sampleSize > 0 ? verdict.sampleSize : null,
        reanalysis_success_count: verdict.sampleSize > 0 ? verdict.successCount : null,
        structure_checked_at: new Date().toISOString(),
      })
      .eq("id", sourceId);

    return verdict;
  } catch {
    return null;
  }
}
