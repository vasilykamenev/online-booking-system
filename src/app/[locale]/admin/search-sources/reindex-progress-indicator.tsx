"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { fetchReindexProgress, type FetchReindexProgressResult } from "@/server/actions/admin";

/** Frequent enough to feel live without hammering the DB on an admin-only, low-traffic page — same
 *  order of magnitude as `resilience/rate-limiter.ts`'s own throttle windows elsewhere in this
 *  codebase's search pipeline. */
const POLL_INTERVAL_MS = 3000;

/**
 * Polls `fetchReindexProgress` (Server Action, admin-gated) for one source and renders nothing at
 * all unless a run is actually in flight — a source that has never been reindexed, or whose last
 * run already finished, shows neither variant. "In flight" is derived, not a stored flag: a start
 * with no finish yet, or a finish older than the current start (a run got kicked off again since).
 *
 * `variant="compact"`: a short inline label for the search-sources list row (Э5). `variant="bar"`:
 * the fuller progress bar for the source's own URL Registry page, next to `ReindexButton` — polls
 * independently of that button's own `isPending`, so a run started from the cron job or another
 * admin tab still shows here.
 */
export function ReindexProgressIndicator({
  sourceId,
  variant = "compact",
}: {
  sourceId: string;
  variant?: "compact" | "bar";
}) {
  const t = useTranslations("admin.searchSources.urlRegistry.reindexProgress");
  const [progress, setProgress] = useState<FetchReindexProgressResult | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      const result = await fetchReindexProgress(sourceId);
      if (!cancelled) setProgress(result);
    }

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [sourceId]);

  if (!progress || progress.error || !progress.startedAt) return null;

  const isRunning = !progress.finishedAt || progress.finishedAt < progress.startedAt;
  if (!isRunning) return null;

  const total = progress.total ?? 0;
  const processed = progress.processed ?? 0;
  const percent = total > 0 ? Math.round((processed / total) * 100) : 0;

  if (variant === "compact") {
    return <span className="text-xs font-light text-muted-foreground">{t("compact", { percent })}</span>;
  }

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between text-xs font-light text-muted-foreground">
        <span>{t("bar", { processed, total })}</span>
        <span>{t("compact", { percent })}</span>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
