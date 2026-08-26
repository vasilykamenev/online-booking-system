import { NextResponse } from "next/server";
import { cleanupStaleListings } from "@/server/search/registry/index-retention";

/**
 * Vercel Cron target (`vercel.json`'s `crons`, daily) — the only scheduled job in this project so
 * far. Deletes stale `search_extracted_listings` rows (design doc §5.1); see
 * `registry/index-retention.ts` for the retention window and why it's longer than P3's read-side
 * freshness TTL.
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

  const result = await cleanupStaleListings();
  return NextResponse.json(result);
}
