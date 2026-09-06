"use client";

import { useTransition } from "react";
import { Power, PowerOff } from "lucide-react";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/routing";
import { useRouter } from "@/i18n/navigation";
import { setSearchSourceEnabled } from "@/server/actions/admin";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

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

  const label = enabled ? t("disable") : t("enable");

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={label}
          disabled={isPending}
          onClick={handleClick}
        >
          {enabled ? (
            <PowerOff className="size-4" strokeWidth={1.5} />
          ) : (
            <Power className="size-4" strokeWidth={1.5} />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
