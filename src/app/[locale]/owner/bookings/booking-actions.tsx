"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/routing";
import { useRouter } from "@/i18n/navigation";
import { updateBookingStatus } from "@/server/actions/bookings";
import { Button } from "@/components/ui/button";

export function BookingActions({
  bookingId,
  status,
}: {
  bookingId: string;
  status: string;
}) {
  const t = useTranslations("owner.bookings");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleUpdate(next: "confirmed" | "cancelled") {
    startTransition(async () => {
      const result = await updateBookingStatus(locale, bookingId, next);
      if (result.error) {
        toast.error(t("updateError"));
        return;
      }
      toast.success(t(next === "confirmed" ? "confirmed" : "cancelled"));
      router.refresh();
    });
  }

  if (status !== "pending" && status !== "confirmed") return null;

  return (
    <div className="flex items-center justify-end gap-1.5">
      {status === "pending" && (
        <Button
          type="button"
          size="sm"
          disabled={isPending}
          onClick={() => handleUpdate("confirmed")}
          className="rounded-full"
        >
          {t("confirm")}
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={isPending}
        onClick={() => handleUpdate("cancelled")}
      >
        {t("cancel")}
      </Button>
    </div>
  );
}
