import "server-only";
import { SITE_NAME } from "@/lib/site";

/**
 * Reads the Anthropic org's own API spend (Admin Cost API), for the `/admin/ai-usage` monitoring
 * widget — added after a real incident where the account's credit balance ran out and every AI
 * call started failing silently (`query-interpreter.ts`'s degrade-to-deterministic path), with
 * nothing surfacing that until a user noticed search quality drop. This widget exists so that's
 * visible before it silently degrades a feature again.
 *
 * Deliberately a separate credential from `ANTHROPIC_API_KEY` (see `server/ai/client.ts`): the
 * Cost API requires an Admin API key (`sk-ant-admin...`) or an `org:admin` OAuth token — a regular
 * key is rejected outright. Not in the Anthropic SDK either (Admin usage/cost reports are raw-HTTP
 * only), hence the direct `fetch` here instead of `@anthropic-ai/sdk`.
 */

const COST_REPORT_URL = "https://api.anthropic.com/v1/organizations/cost_report";
const ANTHROPIC_VERSION = "2023-06-01";
const REQUEST_TIMEOUT_MS = 8_000;
/** Cost API bucket limit is 31 max at `1d` width (`usage-cost-api.md`) — 30 gives a full trailing
 *  month while leaving room for `ending_at` to land on a whole-day boundary. */
const LOOKBACK_DAYS = 30;

export interface DailySpend {
  /** ISO date (YYYY-MM-DD), UTC. */
  date: string;
  amountUsd: number;
}

export interface ModelSpend {
  /** Anthropic model id, or "other" for non-token costs (web search, code execution) the report
   *  doesn't attribute to a model. */
  model: string;
  amountUsd: number;
}

export interface AnthropicUsageReport {
  daily: DailySpend[];
  byModel: ModelSpend[];
  last7dTotalUsd: number;
  last30dTotalUsd: number;
}

export type AnthropicUsageOutcome =
  | { status: "ok"; report: AnthropicUsageReport }
  // No Admin API key configured — distinct from "error" so the page can say what to do about it,
  // the same degrade-with-a-reason discipline `query-interpreter.ts`'s `degradedReason` follows.
  | { status: "not-configured" }
  | { status: "error" };

interface CostReportResultItem {
  amount: string;
  model: string | null;
}

interface CostReportBucket {
  starting_at: string;
  results: CostReportResultItem[];
}

interface CostReportResponse {
  data: CostReportBucket[];
}

export async function getAnthropicUsageReport(): Promise<AnthropicUsageOutcome> {
  const apiKey = process.env.ANTHROPIC_ADMIN_API_KEY;
  if (!apiKey) return { status: "not-configured" };

  // Exclusive upper bound at the next UTC midnight so today's (partial) spend is included.
  const endingAt = new Date();
  endingAt.setUTCHours(0, 0, 0, 0);
  endingAt.setUTCDate(endingAt.getUTCDate() + 1);
  const startingAt = new Date(endingAt);
  startingAt.setUTCDate(startingAt.getUTCDate() - LOOKBACK_DAYS);

  const url = new URL(COST_REPORT_URL);
  url.searchParams.set("starting_at", startingAt.toISOString());
  url.searchParams.set("ending_at", endingAt.toISOString());
  url.searchParams.set("limit", String(LOOKBACK_DAYS));
  // Grouping by description is what makes the API parse out `model` per line item — without it,
  // every result collapses to one workspace-wide total per day with `model: null`.
  url.searchParams.append("group_by[]", "description");

  try {
    const response = await fetch(url, {
      headers: {
        "anthropic-version": ANTHROPIC_VERSION,
        "x-api-key": apiKey,
        "User-Agent": `${SITE_NAME}-Admin/1.0`,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      // Docs: cost data lands within ~5 min of a call completing, and the API accepts polling at
      // most once/minute — a 5-minute page-level cache comfortably respects both.
      next: { revalidate: 300 },
    });
    if (!response.ok) return { status: "error" };

    const payload = (await response.json()) as CostReportResponse;
    const daily: DailySpend[] = [];
    const byModelTotals = new Map<string, number>();

    for (const bucket of payload.data) {
      // `amount` is a decimal string in cents (spec example: "123.45" cents = $1.2345) — dividing
      // by 100 here, once, is the only place this report touches money math; everything past this
      // function just formats what's already in dollars.
      const dayTotalUsd = bucket.results.reduce((sum, item) => sum + Number(item.amount) / 100, 0);
      daily.push({ date: bucket.starting_at.slice(0, 10), amountUsd: dayTotalUsd });

      for (const item of bucket.results) {
        const key = item.model ?? "other";
        byModelTotals.set(key, (byModelTotals.get(key) ?? 0) + Number(item.amount) / 100);
      }
    }

    const last30dTotalUsd = daily.reduce((sum, day) => sum + day.amountUsd, 0);
    const last7dTotalUsd = daily.slice(-7).reduce((sum, day) => sum + day.amountUsd, 0);
    const byModel = [...byModelTotals.entries()]
      .map(([model, amountUsd]) => ({ model, amountUsd }))
      .sort((a, b) => b.amountUsd - a.amountUsd);

    return { status: "ok", report: { daily, byModel, last7dTotalUsd, last30dTotalUsd } };
  } catch {
    // Network failure, timeout, invalid/revoked key, wrong key type (a non-admin key is rejected
    // outright) — all surface the same generic error state; the admin still has server logs for
    // the specifics, same tradeoff `query-interpreter.ts`'s `ai-error` degrade makes.
    return { status: "error" };
  }
}
