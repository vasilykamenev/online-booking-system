"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/routing";
import { useRouter } from "@/i18n/navigation";
import { createCrawlRulesFromRobots } from "@/server/actions/admin";
import { Button } from "@/components/ui/button";

export function CreateRulesFromRobotsButton({ sourceId }: { sourceId: string }) {
  const t = useTranslations("admin.searchSources.crawlRules.robots");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const result = await createCrawlRulesFromRobots(locale, sourceId);
      if (result.error) {
        toast.error(t(`createFromRobotsErrors.${result.error}`));
        return;
      }
      if (result.created === 0) {
        toast.info(t("createFromRobotsNoneNew", { skipped: result.skipped ?? 0 }));
        return;
      }
      toast.success(t("createFromRobotsSuccess", { created: result.created ?? 0 }));
      router.refresh();
    });
  }

  return (
    <Button variant="outline" size="sm" className="rounded-full" disabled={isPending} onClick={handleClick}>
      {t("createFromRobots")}
    </Button>
  );
}
