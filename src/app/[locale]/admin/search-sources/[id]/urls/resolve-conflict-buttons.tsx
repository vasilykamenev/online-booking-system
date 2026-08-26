"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/routing";
import { useRouter } from "@/i18n/navigation";
import { resolveFieldConflict } from "@/server/actions/admin";
import { Button } from "@/components/ui/button";

export function ResolveConflictButtons({ sourceId, conflictId }: { sourceId: string; conflictId: string }) {
  const t = useTranslations("admin.searchSources.urlRegistry.conflicts.actions");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function resolve(resolution: "kept_previous" | "kept_new") {
    startTransition(async () => {
      const result = await resolveFieldConflict(locale, sourceId, conflictId, resolution);
      if (result.error === "stale") {
        toast.error(t("staleError"));
        router.refresh();
        return;
      }
      if (result.error) {
        toast.error(t("error"));
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex gap-2">
      <Button
        variant="outline"
        size="sm"
        className="h-7 rounded-full text-xs"
        disabled={isPending}
        onClick={() => resolve("kept_new")}
      >
        {t("acceptNew")}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 rounded-full text-xs text-muted-foreground"
        disabled={isPending}
        onClick={() => resolve("kept_previous")}
      >
        {t("keepPrevious")}
      </Button>
    </div>
  );
}
