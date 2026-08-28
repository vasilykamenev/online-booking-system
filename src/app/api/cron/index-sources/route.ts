import { NextResponse } from "next/server";
import { listEnabledSources } from "@/server/search/source-registry";
import { indexSource } from "@/server/search/index/indexer";

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
