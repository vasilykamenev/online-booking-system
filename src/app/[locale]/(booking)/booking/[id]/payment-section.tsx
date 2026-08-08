"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/routing";
import {
  startCardPayment,
  startBankTransfer,
  type PaymentActionState,
} from "@/server/actions/payments";
import { Button } from "@/components/ui/button";
import type { BookingPaymentInfo } from "@/server/queries/bookings";

export function PaymentSection({
  bookingId,
  bookingStatus,
  latestPayment,
}: {
  bookingId: string;
  bookingStatus: string;
  latestPayment: BookingPaymentInfo | null;
}) {
  const t = useTranslations("booking.payment");
  const locale = useLocale() as Locale;
  const [isCardPending, startCard] = useTransition();
  const [isTransferPending, startTransfer] = useTransition();

  function reportError(result: PaymentActionState) {
    if (result.error) toast.error(t(`errors.${result.error}`));
  }

  function handleCardPayment() {
    startCard(async () => {
      const result = await startCardPayment(locale, bookingId);
      reportError(result);
    });
  }

  function handleBankTransfer() {
    startTransfer(async () => {
      const result = await startBankTransfer(locale, bookingId);
      reportError(result);
    });
  }

  if (bookingStatus === "paid" || bookingStatus === "completed") {
    return (
      <p className="mt-6 rounded-xl bg-primary/10 px-4 py-3 text-sm font-light text-primary">
        {t("paid")}
      </p>
    );
  }

  if (bookingStatus === "cancelled") return null;

  if (latestPayment?.provider === "bank_transfer" && latestPayment.status === "pending") {
    return (
      <div className="mt-6 rounded-xl bg-muted px-4 py-3 text-sm font-light text-muted-foreground">
        <p>{t("bankTransferPending")}</p>
        <p className="mt-2 whitespace-pre-line">{t("bankTransferInstructions")}</p>
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-3">
      <p className="text-sm font-light text-muted-foreground">{t("choosePrompt")}</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          type="button"
          disabled={isCardPending || isTransferPending}
          onClick={handleCardPayment}
          className="flex-1 rounded-full"
        >
          {t("payByCard")}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={isCardPending || isTransferPending}
          onClick={handleBankTransfer}
          className="flex-1 rounded-full"
        >
          {t("payByBankTransfer")}
        </Button>
      </div>
    </div>
  );
}
