import { NextResponse } from "next/server";
import { listEnabledSources } from "@/server/search/source-registry";
import { indexSource } from "@/server/search/index/indexer";
import { resolveCronStartFrom, recordCronError, clearCronError } from "@/server/search/index/reindex-progress";

/** Same 300s ceiling `urls/page.tsx` sets for the manual "Индексировать сейчас" trigger — without an
 *  explicit `maxDuration`, this route falls back to the framework/plan default (1 minute, per the
 *  Vercel dashboard), which is nowhere near enough for `indexSource` to get through even one
 *  medium-sized source's full candidate list at its throttled rps, let alone every enabled source in
 *  one cron tick. `300` is this Hobby-plan project's actual ceiling (see that page's own doc comment
 *  on why `800` isn't a valid value here) — a source whose crawl still can't finish inside that gets
 *  cut off exactly like a manual run would (its own `reindex_max_duration_seconds` budget, checked
 *  inside the batch loop, is meant to fire well before this hard cutoff does). What happens next is
 *  no longer "restart from the top, forever" — see `resolveCronStartFrom` below. */
export const maxDuration = 300;

/**
 * Vercel Cron target (`vercel.json`'s `crons`, once daily — Hobby plan doesn't allow more often).
 * The background indexer (Э5, Арх §12), run across every currently enabled+active source.
 *
 * Resume-aware, not always-fresh: `resolveCronStartFrom` decides per source whether this tick does a
 * full fresh pass (never indexed before, or fully completed last time), resumes a run that stopped
 * partway (deadline or manual Stop from a previous tick/click), or skips the source entirely this
 * tick (a run that still looks genuinely in flight — same guard `beginResume` gives the admin's
 * manual "Продолжить"). A source that can't finish its whole catalog in one 300s tick therefore keeps
 * making progress across days instead of restarting from zero forever.
 *
 * One source's failure never sinks the run — `indexSource` itself is designed to never throw (see its
 * own doc comment), and this handler still `Promise.allSettled`s across sources on top of that so a
 * genuinely unexpected exception in one source's run can't stop the rest from being attempted. Unlike
 * before, a real reject is no longer silently dropped into a JSON response nobody reads: it's
 * persisted via `recordCronError` and shown as a badge on `/admin/search-sources` — cleared again
 * (`clearCronError`) the moment a later run for that source completes without throwing.
 *
 * Same `CRON_SECRET` bearer-auth convention as `api/cron/cleanup-search-index` — see that route's
 * own doc comment for why an unset secret is refused rather than treated as "no auth needed".
 */
export async function GET(request: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sources = await listEnabledSources();
  const settled = await Promise.allSettled(
    sources.map(async (source) => {
      const cursor = await resolveCronStartFrom(source.id);
      if (!cursor) return { sourceId: source.id, skipped: true as const };
      const result = await indexSource(source.id, { startFrom: cursor.startFrom });
      await clearCronError(source.id);
      return result;
    }),
  );

  const results = await Promise.all(
    settled.map(async (outcome, i) => {
      if (outcome.status === "fulfilled") return outcome.value;
      const message = String(outcome.reason);
      await recordCronError(sources[i].id, message);
      return { sourceId: sources[i].id, error: message };
    }),
  );

  return NextResponse.json({ sourcesIndexed: sources.length, results });
}
