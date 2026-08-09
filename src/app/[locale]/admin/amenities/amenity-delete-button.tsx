"use client";

import { useTransition } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/routing";
import { useRouter } from "@/i18n/navigation";
import { deleteAmenity } from "@/server/actions/admin";
import { Button } from "@/components/ui/button";

export function AmenityDeleteButton({ amenityId }: { amenityId: string }) {
  const t = useTranslations("admin.amenities");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    if (!window.confirm(t("confirmDelete"))) return;

    startTransition(async () => {
      const result = await deleteAmenity(locale, amenityId);
      if (result.error) {
        toast.error(t("deleteError"));
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
