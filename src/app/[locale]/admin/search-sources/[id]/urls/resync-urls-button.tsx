"use client";

import { useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/routing";
import { useRouter } from "@/i18n/navigation";
import { resyncSearchSourceUrls } from "@/server/actions/admin";
import { Button } from "@/components/ui/button";

export function ResyncUrlsButton({ sourceId }: { sourceId: string }) {
  const t = useTranslations("admin.searchSources.urlRegistry");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const result = await resyncSearchSourceUrls(locale, sourceId);
      if (result.error) {
        toast.error(t(`resyncErrors.${result.error}`));
        return;
      }
      toast.success(t("resyncSuccess", { count: result.discovered ?? 0 }));
      if (result.truncated) toast.warning(t("resyncTruncated"));
      router.refresh();
    });
  }

  return (
    <Button variant="outline" size="sm" className="rounded-full" disabled={isPending} onClick={handleClick}>
      <RefreshCw className="size-4" strokeWidth={1.5} />
      {t("resyncNow")}
    </Button>
  );
}
