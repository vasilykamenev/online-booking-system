"use client";

import { useEffect, useTransition } from "react";
import { Database, Play, Square } from "lucide-react";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/routing";
import { useRouter } from "@/i18n/navigation";
import {
  reindexSearchSource,
  resumeSearchSourceIndexing,
  stopSearchSourceIndexing,
} from "@/server/actions/admin";
import { useReindexStatus } from "@/lib/search/use-reindex-status";
import { Button } from "@/components/ui/button";

/** Same gap the deadline itself is set below Vercel's own 300s ceiling for (see
 *  `reindex-timing.ts`) — a little slack past `reindex_max_duration_seconds` before auto-resuming,
 *  so this doesn't race the write `cancelReindexProgress` makes at the moment the deadline actually
 *  fires. Manual testing's "keep scanning until 100% while the tab is open" request. */
const AUTO_RESUME_DELAY_MS = 15_000;

/** Э5's manual trigger, extended for manual testing with Resume/Stop — same "run the background job
 *  on demand" pattern as `ResyncUrlsButton`, for the indexer instead of the URL Registry sync. Every
 *  action here returns as soon as it's scheduled/applied; `ReindexProgressIndicator` on this same
 *  page (polling the same `useReindexStatus`) is the actual feedback for the run itself.
 *
 * Also drives auto-resume: a run that stopped itself on its own time budget (`canAutoResume`, never
 * true for a manual Stop — see `useReindexStatus`'s own doc comment) gets clicked again automatically
 * after `AUTO_RESUME_DELAY_MS`, repeating every time it stops short again, until it reaches 100%. This
 * only happens while this component is mounted (the admin has this page open) — Vercel serverless has
 * no reliable way to wake itself back up on a timer once the response has been sent, and Vercel Cron
 * on this project's Hobby plan can't be scheduled more often than once a day, so the open tab is the
 * only channel that can react within seconds rather than waiting for tomorrow. */
export function ReindexButton({ sourceId }: { sourceId: string }) {
  const t = useTranslations("admin.searchSources.urlRegistry");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const { isRunning, canResume, canAutoResume } = useReindexStatus(sourceId);

  const [isStartPending, startStartTransition] = useTransition();
  const [isResumePending, startResumeTransition] = useTransition();
  const [isStopPending, startStopTransition] = useTransition();

  useEffect(() => {
    if (!canAutoResume) return;

    const timer = setTimeout(() => {
      startResumeTransition(async () => {
        const result = await resumeSearchSourceIndexing(locale, sourceId);
        if (result.error) {
          toast.error(t(`resumeErrors.${result.error}`));
          return;
        }
        toast.success(t("resumeStarted"));
        router.refresh();
      });
    }, AUTO_RESUME_DELAY_MS);

    return () => clearTimeout(timer);
    // Intentionally fires once per `canAutoResume` false→true transition, not on every 3s poll tick
    // while it stays true — `startResumeTransition`/`router` are stable (useTransition/next-intl's
    // navigation hook), `sourceId`/`locale` only change on a route change (a remount anyway). `t` and
    // a freshly-bound `handleResume`-style closure are deliberately left out: including either would
    // reset this timer on every render, since both get a new reference each poll and would never let
    // 15s actually elapse.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAutoResume, sourceId, locale]);

  function handleStart() {
    startStartTransition(async () => {
      const result = await reindexSearchSource(locale, sourceId);
      if (result.error) {
        toast.error(t(`resyncErrors.${result.error}`));
        return;
      }
      toast.success(t("reindexStarted"));
      router.refresh();
    });
  }

  function handleResume() {
    startResumeTransition(async () => {
      const result = await resumeSearchSourceIndexing(locale, sourceId);
      if (result.error) {
        toast.error(t(`resumeErrors.${result.error}`));
        return;
      }
      toast.success(t("resumeStarted"));
      router.refresh();
    });
  }

  function handleStop() {
    startStopTransition(async () => {
      const result = await stopSearchSourceIndexing(locale, sourceId);
      if (result.error) {
        toast.error(t(`stopErrors.${result.error}`));
        return;
      }
      toast.success(t("stopRequested"));
      router.refresh();
    });
  }

  if (isRunning) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="rounded-full"
        disabled={isStopPending}
        onClick={handleStop}
      >
        <Square className="size-4" strokeWidth={1.5} />
        {isStopPending ? t("stopping") : t("stopNow")}
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {canResume && (
        <Button
          variant="outline"
          size="sm"
          className="rounded-full"
          disabled={isResumePending}
          onClick={handleResume}
        >
          <Play className="size-4" strokeWidth={1.5} />
          {isResumePending ? t("resuming") : t("resumeNow")}
        </Button>
      )}
      <Button
        variant="outline"
        size="sm"
        className="rounded-full"
        disabled={isStartPending}
        onClick={handleStart}
      >
        <Database className="size-4" strokeWidth={1.5} />
        {isStartPending ? t("reindexing") : t("reindexNow")}
      </Button>
    </div>
  );
}
