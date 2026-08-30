"use client";

import { useTransition } from "react";
import { Database } from "lucide-react";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/routing";
import { useRouter } from "@/i18n/navigation";
import { reindexSearchSource } from "@/server/actions/admin";
import { Button } from "@/components/ui/button";

/** Э5's manual trigger — same "run the background job on demand" pattern as `ResyncUrlsButton`,
 *  for the indexer instead of the URL Registry sync. The action itself now returns as soon as the
 *  crawl is scheduled (`actions/admin.ts`'s own doc comment on why) — this button's own pending
 *  spinner is therefore only ever brief; `ReindexProgressIndicator` on this same page is the actual
 *  feedback for the run itself, polled independently of this click. */
export function ReindexButton({ sourceId }: { sourceId: string }) {
  const t = useTranslations("admin.searchSources.urlRegistry");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const result = await reindexSearchSource(locale, sourceId);
      if (result.error) {
        toast.error(t(`resyncErrors.${result.error}`));
        return;
      }
      toast.success(t("reindexStarted"));
      router.refresh();
    });
  }

  return (
    <Button variant="outline" size="sm" className="rounded-full" disabled={isPending} onClick={handleClick}>
      <Database className="size-4" strokeWidth={1.5} />
      {isPending ? t("reindexing") : t("reindexNow")}
    </Button>
  );
}
