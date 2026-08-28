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
 *  for the indexer instead of the URL Registry sync. Can take a while (every `selected` URL, live
 *  fetches included) — the pending spinner is the only feedback until it resolves, same as resync. */
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
      toast.success(
        t("reindexSuccess", { listed: result.listingsIndexed ?? 0, total: result.urlsConsidered ?? 0 }),
      );
      if (result.pagesFailed) toast.warning(t("reindexFailed", { count: result.pagesFailed }));
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
