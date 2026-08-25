"use client";

import { useTransition } from "react";
import { Eraser } from "lucide-react";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/routing";
import { useRouter } from "@/i18n/navigation";
import { clearSourceUrlRegistry } from "@/server/actions/admin";
import { Button } from "@/components/ui/button";

export function ClearUrlsButton({ sourceId }: { sourceId: string }) {
  const t = useTranslations("admin.searchSources.urlRegistry");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    if (!window.confirm(t("clearConfirm"))) return;

    startTransition(async () => {
      const result = await clearSourceUrlRegistry(locale, sourceId);
      if (result.error) {
        toast.error(t(`clearErrors.${result.error}`));
        return;
      }
      toast.success(t("clearSuccess", { count: result.deleted ?? 0 }));
      router.refresh();
    });
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="rounded-full"
      disabled={isPending}
      onClick={handleClick}
    >
      <Eraser className="size-4" strokeWidth={1.5} />
      {t("clearAll")}
    </Button>
  );
}
