"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/routing";
import { useRouter } from "@/i18n/navigation";
import { approveSearchSource, rejectSearchSource } from "@/server/actions/admin";
import type { Database } from "@/lib/supabase/database.types";
import { Button } from "@/components/ui/button";

type SearchSourceStatus = Database["public"]["Enums"]["search_source_status"];

/** Draft/needs_review/rejected rows get approve/reject instead of the enable/disable toggle
 *  (`SearchSourceToggleButton`), which only makes sense once a source is active. */
export function SearchSourceStatusActions({
  sourceId,
  status,
}: {
  sourceId: string;
  status: SearchSourceStatus;
}) {
  const t = useTranslations("admin.searchSources.lifecycle");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleApprove() {
    startTransition(async () => {
      const result = await approveSearchSource(locale, sourceId);
      if (result.error) {
        toast.error(t(`errors.${result.error}`));
        return;
      }
      toast.success(t("toast.approved"));
      router.refresh();
    });
  }

  function handleReject() {
    startTransition(async () => {
      const result = await rejectSearchSource(locale, sourceId);
      if (result.error) {
        toast.error(t(`errors.${result.error}`));
        return;
      }
      toast.success(t("toast.rejected"));
      router.refresh();
    });
  }

  return (
    <div className="flex items-center justify-end gap-1">
      {status !== "active" && (
        <Button
          variant="outline"
          size="sm"
          className="rounded-full"
          disabled={isPending}
          onClick={handleApprove}
        >
          {t("actions.approve")}
        </Button>
      )}
      {status !== "rejected" && (
        <Button
          variant="ghost"
          size="sm"
          className="rounded-full text-destructive hover:text-destructive"
          disabled={isPending}
          onClick={handleReject}
        >
          {t("actions.reject")}
        </Button>
      )}
    </div>
  );
}
