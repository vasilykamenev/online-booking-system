"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/routing";
import {
  startCardPayment,
  startBankTransfer,
  cancelPendingPayment,
  type PaymentActionState,
} from "@/server/actions/payments";
import { selectBookingPaymentMethod } from "@/server/actions/bookings";
import { canSelectPaymentMethod } from "@/lib/booking/payment-flow";
import { calculatePlatformFee } from "@/lib/pricing/commission";
import { formatPrice } from "@/lib/pricing/format";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { BookingDetail, BookingPaymentInfo } from "@/server/queries/bookings";
import type { Database } from "@/lib/supabase/database.types";

type PaymentProvider = Database["public"]["Enums"]["payment_provider"];

export function PaymentSection({
  bookingId,
  bookingStatus,
  paymentMethod,
  latestPayment,
  payments,
  priceMinor,
  currency,
  commissionRate,
}: {
  bookingId: string;
  bookingStatus: BookingDetail["status"];
  paymentMethod: PaymentProvider | null;
  latestPayment: BookingPaymentInfo | null;
  payments: BookingPaymentInfo[];
  priceMinor: number;
  currency: string;
  commissionRate: number;
}) {
  const t = useTranslations("booking.payment");
  const locale = useLocale() as Locale;
  const [isCardPending, startCard] = useTransition();
  const [isTransferPending, startTransfer] = useTransition();
  const [isSelecting, startSelecting] = useTransition();
  const [isCancelling, startCancelling] = useTransition();
  const [agreed, setAgreed] = useState(false);
  const [pickingMethod, setPickingMethod] = useState(false);

  function reportError(result: { error?: string }) {
    if (result.error) toast.error(t(`errors.${result.error}`));
  }

  function handleSelectMethod(method: PaymentProvider) {
    startSelecting(async () => {
      const result = await selectBookingPaymentMethod(locale, bookingId, method);
      reportError(result);
      if (!result.error) setPickingMethod(false);
    });
  }

  function handleCardPayment() {
    startCard(async () => {
      const result: PaymentActionState = await startCardPayment(locale, bookingId);
      reportError(result);
    });
  }

  function handleBankTransfer() {
    startTransfer(async () => {
      const result = await startBankTransfer(locale, bookingId);
      reportError(result);
    });
  }

  function handleCancelPayment(paymentId: string) {
    startCancelling(async () => {
      const result = await cancelPendingPayment(locale, paymentId);
      reportError(result);
    });
  }

  if (bookingStatus === "paid" || bookingStatus === "completed") {
    return (
      <div className="mt-6 space-y-4">
        <p className="rounded-xl bg-primary/10 px-4 py-3 text-sm font-light text-primary">
          {t("paid")}
        </p>
        <PaymentHistory payments={payments} currency={currency} t={t} />
      </div>
    );
  }

  if (bookingStatus === "cancelled") return null;

  const methodPickerVisible = pickingMethod || (!paymentMethod && canSelectPaymentMethod(bookingStatus));

  if (methodPickerVisible) {
    return (
      <div className="mt-6 space-y-3">
        <p className="text-sm font-light text-muted-foreground">{t("choosePrompt")}</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            type="button"
            disabled={isSelecting}
            onClick={() => handleSelectMethod("stripe")}
            className="flex-1 rounded-full"
          >
            {t("payByCard")}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={isSelecting}
            onClick={() => handleSelectMethod("bank_transfer")}
            className="flex-1 rounded-full"
          >
            {t("payByBankTransfer")}
          </Button>
        </div>
        {paymentMethod && (
          <button
            type="button"
            onClick={() => setPickingMethod(false)}
            className="text-xs font-light text-muted-foreground underline-offset-2 hover:underline"
          >
            {t("cancelChangeMethod")}
          </button>
        )}
      </div>
    );
  }

  if (bookingStatus === "pending" && paymentMethod) {
    return (
      <div className="mt-6 space-y-3">
        <div className="rounded-xl bg-muted px-4 py-3 text-sm font-light text-muted-foreground">
          <p>{t("waitingOwnerConfirmation", { method: t(`method.${paymentMethod}`) })}</p>
        </div>
        <button
          type="button"
          onClick={() => setPickingMethod(true)}
          className="text-xs font-light text-muted-foreground underline-offset-2 hover:underline"
        >
          {t("changeMethod")}
        </button>
      </div>
    );
  }

  // bookingStatus === "confirmed" from here on.

  if (latestPayment?.status === "pending") {
    const isBankTransfer = latestPayment.provider === "bank_transfer";
    return (
      <div className="mt-6 space-y-3">
        <div className="rounded-xl bg-muted px-4 py-3 text-sm font-light text-muted-foreground">
          <p>{isBankTransfer ? t("bankTransferPending") : t("cardPaymentPending")}</p>
          {isBankTransfer && <p className="mt-2 whitespace-pre-line">{t("bankTransferInstructions")}</p>}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={isCancelling}
          onClick={() => handleCancelPayment(latestPayment.id)}
        >
          {t("cancelPayment")}
        </Button>
        <PaymentHistory payments={payments} currency={currency} t={t} />
      </div>
    );
  }

  const feeMinor = calculatePlatformFee(priceMinor, commissionRate);
  const feePercent = Math.round(commissionRate * 100);

  return (
    <div className="mt-6 space-y-4">
      {latestPayment?.status === "failed" && (
        <p className="rounded-xl bg-destructive/10 px-4 py-3 text-sm font-light text-destructive">
          {t("paymentFailed", { reason: latestPayment.failureReason ?? t("unknownReason") })}
        </p>
      )}
      {latestPayment?.status === "cancelled" && (
        <p className="rounded-xl bg-muted px-4 py-3 text-sm font-light text-muted-foreground">
          {t("paymentCancelled")}
        </p>
      )}

      <div className="space-y-2 rounded-xl border border-border bg-muted/50 px-4 py-3 text-sm font-light text-muted-foreground">
        <p>{t("disclosure.fee", { percent: feePercent, amount: formatPrice(feeMinor, currency, locale) })}</p>
        <p>{t("disclosure.liability")}</p>
        <p>{t("disclosure.cancellation")}</p>
      </div>

      <div className="flex items-start gap-2">
        <Checkbox
          id="payment-agree"
          checked={agreed}
          onCheckedChange={(value) => setAgreed(value === true)}
        />
        <Label htmlFor="payment-agree" className="text-sm font-light text-muted-foreground">
          {t("agree")}
        </Label>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        {paymentMethod === "stripe" && (
          <Button
            type="button"
            disabled={!agreed || isCardPending}
            onClick={handleCardPayment}
            className="flex-1 rounded-full"
          >
            {t("payNow")}
          </Button>
        )}
        {paymentMethod === "bank_transfer" && (
          <Button
            type="button"
            disabled={!agreed || isTransferPending}
            onClick={handleBankTransfer}
            className="flex-1 rounded-full"
          >
            {t("payNow")}
          </Button>
        )}
      </div>

      <button
        type="button"
        onClick={() => setPickingMethod(true)}
        className="text-xs font-light text-muted-foreground underline-offset-2 hover:underline"
      >
        {t("changeMethod")}
      </button>

      <PaymentHistory payments={payments} currency={currency} t={t} />
    </div>
  );
}

function PaymentHistory({
  payments,
  currency,
  t,
}: {
  payments: BookingPaymentInfo[];
  currency: string;
  t: ReturnType<typeof useTranslations>;
}) {
  const locale = useLocale() as Locale;
  if (payments.length === 0) return null;

  const dateFormatter = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });

  return (
    <div className="border-t border-border pt-4">
      <span className="uppercase-label">{t("history.title")}</span>
      <ul className="mt-2 space-y-2">
        {payments.map((payment) => (
          <li key={payment.id} className="flex items-center justify-between text-xs font-light text-muted-foreground">
            <span>
              {dateFormatter.format(new Date(payment.createdAt))} · {t(`method.${payment.provider}`)} ·{" "}
              {formatPrice(payment.amountMinor, currency, locale)}
            </span>
            <span>
              {t(`history.status.${payment.status}`)}
              {payment.failureReason ? ` — ${payment.failureReason}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
