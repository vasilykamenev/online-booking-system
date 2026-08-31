import { NextResponse } from "next/server";
import { listEnabledSources } from "@/server/search/source-registry";
import { indexSource } from "@/server/search/index/indexer";

/** Same 300s ceiling `urls/page.tsx` sets for the manual "Индексировать сейчас" trigger — without an
 *  explicit `maxDuration`, this route falls back to the framework/plan default (1 minute, per the
 *  Vercel dashboard), which is nowhere near enough for `indexSource` to get through even one
 *  medium-sized source's full candidate list at its throttled rps, let alone every enabled source in
 *  one cron tick. `300` is this Hobby-plan project's actual ceiling (see that page's own doc comment
 *  on why `800` isn't a valid value here) — a source whose crawl still can't finish inside that gets
 *  cut off exactly like a manual run would, visible the same way (its progress row simply stops).
 *  Note this route always calls `indexSource(source.id)` with no `startFrom` — the next scheduled
 *  tick restarts that source from the top rather than resuming; only the admin's manual "Продолжить"
 *  (`resumeSearchSourceIndexing`) does that. */
export const maxDuration = 300;

/**
 * Vercel Cron target (`vercel.json`'s `crons`) — the background indexer (Э5, Арх §12), run across
 * every currently enabled+active source. Recommended schedule: every 12-24h (charter catalogs move
 * by the week, not the minute — see `docs/AI_Federated_Search_Migration_Plan_v1.md` §6's Э5).
 *
 * One source's failure never sinks the run — `indexSource` itself never throws (see its own doc
 * comment), and this handler still `Promise.allSettled`s across sources on top of that so a
 * synchronous throw somewhere unexpected in one source's run can't stop the rest from being
 * attempted.
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
  const settled = await Promise.allSettled(sources.map((source) => indexSource(source.id)));

  const results = settled.map((outcome, i) =>
    outcome.status === "fulfilled"
      ? outcome.value
      : { sourceId: sources[i].id, error: String(outcome.reason) },
  );

  return NextResponse.json({ sourcesIndexed: sources.length, results });
}
