"use client";

import { useTransition } from "react";
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

/** Э5's manual trigger, extended for manual testing with Resume/Stop — same "run the background job
 *  on demand" pattern as `ResyncUrlsButton`, for the indexer instead of the URL Registry sync. Every
 *  action here returns as soon as it's scheduled/applied; `ReindexProgressIndicator` on this same
 *  page (polling the same `useReindexStatus`) is the actual feedback for the run itself. */
export function ReindexButton({ sourceId }: { sourceId: string }) {
  const t = useTranslations("admin.searchSources.urlRegistry");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const { isRunning, canResume } = useReindexStatus(sourceId);

  const [isStartPending, startStartTransition] = useTransition();
  const [isResumePending, startResumeTransition] = useTransition();
  const [isStopPending, startStopTransition] = useTransition();

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
