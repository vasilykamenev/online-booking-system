"use client";

import { useTranslations } from "next-intl";
import { useReindexStatus } from "@/lib/search/use-reindex-status";

/**
 * Renders one of three states for a source's indexing pass, derived by `useReindexStatus` from the
 * same polled `fetchReindexProgress` row `ReindexButton` reads: nothing at all if there's neither a
 * run in flight nor one left resumable; an animated bar/percent while running; or, since Resume/Stop
 * (manual testing), a static bar at the last recorded percent with a "stopped" label when a run was
 * cancelled or presumed timed out but still has pages left to resume — so a tester sees there's
 * something to continue instead of the bar just vanishing.
 *
 * `variant="compact"`: a short inline label for the search-sources list row (Э5). `variant="bar"`:
 * the fuller progress bar for the source's own URL Registry page, next to `ReindexButton` — polls
 * independently of that button's own state, so a run started from the cron job or another admin tab
 * still shows here.
 */
export function ReindexProgressIndicator({
  sourceId,
  variant = "compact",
}: {
  sourceId: string;
  variant?: "compact" | "bar";
}) {
  const t = useTranslations("admin.searchSources.urlRegistry.reindexProgress");
  const { progress, isRunning, canResume, percent } = useReindexStatus(sourceId);

  if (!isRunning && !canResume) return null;

  const total = progress?.total ?? 0;
  const processed = progress?.processed ?? 0;

  if (variant === "compact") {
    return (
      <span className="text-xs font-light text-muted-foreground">
        {isRunning ? t("compact", { percent }) : t("stopped", { processed, total })}
      </span>
    );
  }

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between text-xs font-light text-muted-foreground">
        <span>{isRunning ? t("bar", { processed, total }) : t("stopped", { processed, total })}</span>
        {isRunning && <span>{t("compact", { percent })}</span>}
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full bg-primary ${isRunning ? "transition-[width] duration-500 ease-out" : "opacity-50"}`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
