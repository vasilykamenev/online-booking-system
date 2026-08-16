"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/routing";
import { useRouter } from "@/i18n/navigation";
import { updateBookingStatus } from "@/server/actions/bookings";
import { confirmBankTransferPayment } from "@/server/actions/payments";
import { canOwnerConfirm } from "@/lib/booking/payment-flow";
import { Button } from "@/components/ui/button";
import type { BookingPaymentInfo } from "@/server/queries/bookings";
import type { Database } from "@/lib/supabase/database.types";

export function BookingActions({
  bookingId,
  status,
  paymentMethod,
  latestPayment,
}: {
  bookingId: string;
  status: Database["public"]["Enums"]["booking_status"];
  paymentMethod: Database["public"]["Enums"]["payment_provider"] | null;
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
        toast.error(t(result.error === "paymentMethodMissing" ? "paymentMethodMissing" : "updateError"));
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

  const canConfirm = canOwnerConfirm(status, paymentMethod);

  return (
    <div className="flex flex-col items-end gap-1.5">
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
            disabled={isPending || !canConfirm}
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
      {status === "pending" && !paymentMethod && (
        <span className="text-xs font-light text-muted-foreground">{t("awaitingPaymentMethod")}</span>
      )}
    </div>
  );
}
