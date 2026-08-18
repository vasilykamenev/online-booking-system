import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import { parseDateRangeLiteral } from "@/lib/supabase/date-range";
import { throwIfSupabaseError } from "@/lib/supabase/errors";

export interface BookingPaymentInfo {
  id: string;
  provider: Database["public"]["Enums"]["payment_provider"];
  status: Database["public"]["Enums"]["payment_status"];
  amountMinor: number;
  currency: string;
  failureReason: string | null;
  createdAt: string;
}

export interface BookingDetail {
  id: string;
  clientId: string;
  vesselSlug: string;
  vesselName: string;
  vesselImageUrl: string | null;
  dateRange: { start: string; end: string };
  guestsCount: number;
  status: Database["public"]["Enums"]["booking_status"];
  paymentMethod: Database["public"]["Enums"]["payment_provider"] | null;
  priceMinor: number;
  currency: string;
  createdAt: string;
  latestPayment: BookingPaymentInfo | null;
  /** Every attempt (success and failure), newest first — the payment audit trail for this booking. */
  payments: BookingPaymentInfo[];
}

/** RLS scopes reads to the booking's own client, the vessel owner, or an admin — anyone else gets `null`. */
export async function getBookingById(id: string): Promise<BookingDetail | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("bookings")
    .select(
      `id, client_id, date_range, guests_count, status, payment_method, price_minor, currency, created_at,
       vessels ( slug, name, vessel_images ( url, sort_order ) ),
       payments ( id, provider, status, amount_minor, currency, failure_reason, created_at )`,
    )
    .eq("id", id)
    .maybeSingle();

  throwIfSupabaseError(error);
  if (!data) return null;

  const images = [...(data.vessels?.vessel_images ?? [])].sort(
    (a, b) => a.sort_order - b.sort_order,
  );
  const payments = [...data.payments]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .map((payment) => ({
      id: payment.id,
      provider: payment.provider,
      status: payment.status,
      amountMinor: payment.amount_minor,
      currency: payment.currency,
      failureReason: payment.failure_reason,
      createdAt: payment.created_at,
    }));

  return {
    id: data.id,
    clientId: data.client_id,
    vesselSlug: data.vessels?.slug ?? "",
    vesselName: data.vessels?.name ?? "",
    vesselImageUrl: images[0]?.url ?? null,
    dateRange: parseDateRangeLiteral(data.date_range as string),
    guestsCount: data.guests_count,
    status: data.status,
    paymentMethod: data.payment_method,
    priceMinor: data.price_minor,
    currency: data.currency,
    createdAt: data.created_at,
    latestPayment: payments[0] ?? null,
    payments,
  };
}
