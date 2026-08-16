import type { Database } from "@/lib/supabase/database.types";

type BookingStatus = Database["public"]["Enums"]["booking_status"];
type PaymentProvider = Database["public"]["Enums"]["payment_provider"];

/** Client may declare/change a payment method any time before the deal is settled. */
export function canSelectPaymentMethod(status: BookingStatus): boolean {
  return status === "pending" || status === "confirmed";
}

/** Owner may only accept a pending booking once the client has declared a payment method —
 * confirming means accepting both the dates and that method in one step. */
export function canOwnerConfirm(
  status: BookingStatus,
  paymentMethod: PaymentProvider | null,
): boolean {
  return status === "pending" && paymentMethod !== null;
}

/** Payment can only start once the owner has confirmed, and only via the agreed method. */
export function canStartPayment(
  status: BookingStatus,
  paymentMethod: PaymentProvider | null,
  requestedProvider: PaymentProvider,
): boolean {
  return status === "confirmed" && paymentMethod === requestedProvider;
}
