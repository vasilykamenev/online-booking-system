"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/routing";
import { useRouter } from "@/i18n/navigation";
import { updateBookingStatus } from "@/server/actions/bookings";
import { confirmBankTransferPayment } from "@/server/actions/payments";
import { Button } from "@/components/ui/button";
import type { BookingPaymentInfo } from "@/server/queries/bookings";

export function BookingActions({
  bookingId,
  status,
  latestPayment,
}: {
  bookingId: string;
  status: string;
  latestPayment: BookingPaymentInfo | null;
}) {
  const t = useTranslations("owner.bookings");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isConfirmingTransfer, startTransferConfirm] = useTransition();

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

  function handleConfirmTransfer(paymentId: string) {
    startTransferConfirm(async () => {
      const result = await confirmBankTransferPayment(locale, paymentId);
      if (result.error) {
        toast.error(t("transferConfirmError"));
        return;
      }
      toast.success(t("transferConfirmed"));
      router.refresh();
    });
  }

  const showBankTransferConfirm =
    latestPayment?.provider === "bank_transfer" && latestPayment.status === "pending";

  if (status !== "pending" && status !== "confirmed") return null;

  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {showBankTransferConfirm && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isConfirmingTransfer}
          onClick={() => handleConfirmTransfer(latestPayment.id)}
          className="rounded-full"
        >
          {t("confirmTransfer")}
        </Button>
      )}
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
