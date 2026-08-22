"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/routing";
import { useRouter } from "@/i18n/navigation";
import { setSearchSourceEnabled } from "@/server/actions/admin";
import { Button } from "@/components/ui/button";

export function SearchSourceToggleButton({
  sourceId,
  enabled,
}: {
  sourceId: string;
  enabled: boolean;
}) {
  const t = useTranslations("admin.searchSources");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const result = await setSearchSourceEnabled(locale, sourceId, !enabled);
      if (result.error) {
        toast.error(t(`toggleErrors.${result.error}`));
        return;
      }
      toast.success(enabled ? t("disabled") : t("enabled"));
      router.refresh();
    });
  }

  return (
    <Button
      variant="outline"
      size="sm"
      className="rounded-full"
      disabled={isPending}
      onClick={handleClick}
    >
      {enabled ? t("disable") : t("enable")}
    </Button>
  );
}
