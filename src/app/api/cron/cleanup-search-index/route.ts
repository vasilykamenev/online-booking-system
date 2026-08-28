import { NextResponse } from "next/server";
import { cleanupStaleListings, cleanupGoneListings } from "@/server/search/registry/index-retention";

/**
 * Vercel Cron target (`vercel.json`'s `crons`, daily). Deletes stale `external_vessel_index` rows
 * two ways (design doc §5.1, Э5): `cleanupStaleListings` for a whole source gone quiet (its
 * `last_extracted_at`/P1-P2 cache freshness), `cleanupGoneListings` for one listing the indexer
 * stopped re-confirming on an otherwise still-active source (its `last_seen_at`) — see
 * `registry/index-retention.ts` for why these are two separate windows, not one.
 *
 * Requires `CRON_SECRET` in the environment: Vercel signs every cron invocation with
 * `Authorization: Bearer ${CRON_SECRET}` once that variable is set
 * (https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs) — without it this route
 * would otherwise be triggerable by anyone who finds the URL, so an unset secret is refused rather
 * than treated as "no auth needed". Set it in the Vercel project's environment variables (and
 * `.env.local` for a local test run) — not committed, per CLAUDE.md §11.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const [staleResult, goneResult] = await Promise.all([cleanupStaleListings(), cleanupGoneListings()]);
  return NextResponse.json({ ...staleResult, ...goneResult });
}
