"use client";

import { useTransition } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/routing";
import { useRouter } from "@/i18n/navigation";
import { deleteLocation } from "@/server/actions/admin";
import { Button } from "@/components/ui/button";

export function LocationDeleteButton({ locationId }: { locationId: string }) {
  const t = useTranslations("admin.locations");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    if (!window.confirm(t("confirmDelete"))) return;

    startTransition(async () => {
      const result = await deleteLocation(locale, locationId);
      if (result.error) {
        toast.error(t(`deleteErrors.${result.error}`));
        return;
      }
      toast.success(t("deleted"));
      router.refresh();
    });
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={t("delete")}
      disabled={isPending}
      onClick={handleClick}
    >
      <Trash2 className="size-4" strokeWidth={1.5} />
    </Button>
  );
}
