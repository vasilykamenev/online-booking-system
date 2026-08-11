"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripeClient } from "@/lib/stripe";
import { calculatePlatformFee } from "@/lib/pricing/commission";
import { getPlatformCommissionRate } from "@/server/queries/admin";
import { paymentBookingSchema, confirmBankTransferSchema } from "@/lib/validation/payment";
import { SITE_NAME } from "@/lib/site";
import type { Locale } from "@/i18n/routing";

export interface PaymentActionState {
  error?: "invalid" | "unauthenticated" | "forbidden" | "invalidStatus" | "generic";
}

async function getOrigin(): Promise<string> {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  const headersList = await headers();
  const host = headersList.get("host") ?? "localhost:3000";
  const protocol = host.startsWith("localhost") ? "http" : "https";
  return `${protocol}://${host}`;
}

/** Loads the booking and checks the caller is its client and it's still payable. */
async function loadPayableBooking(bookingId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "unauthenticated" as const };

  const { data: booking, error } = await supabase
    .from("bookings")
    .select("id, status, price_minor, currency, client_id, vessels ( name )")
    .eq("id", bookingId)
    .maybeSingle();
  if (error || !booking) return { error: "generic" as const };
  if (booking.client_id !== user.id) return { error: "forbidden" as const };
  if (booking.status !== "pending" && booking.status !== "confirmed") {
    return { error: "invalidStatus" as const };
  }

  return { booking };
}

/** Card payments — confirmed only by the Stripe webhook, never by this redirect (CLAUDE.md §8). */
export async function startCardPayment(
  locale: Locale,
  bookingId: string,
): Promise<PaymentActionState> {
  const parsed = paymentBookingSchema.safeParse({ bookingId });
  if (!parsed.success) return { error: "invalid" };

  const loaded = await loadPayableBooking(parsed.data.bookingId);
  if ("error" in loaded) return { error: loaded.error };
  const { booking } = loaded;

  const admin = createAdminClient();
  const { data: payment, error: paymentError } = await admin
    .from("payments")
    .insert({
      booking_id: booking.id,
      provider: "stripe",
      status: "pending",
      amount_minor: booking.price_minor,
      currency: booking.currency,
    })
    .select("id")
    .single();
  if (paymentError) return { error: "generic" };

  const origin = await getOrigin();
  const stripe = getStripeClient();
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: booking.currency.toLowerCase(),
          unit_amount: booking.price_minor,
          product_data: { name: `${SITE_NAME} — ${booking.vessels?.name ?? "бронирование"}` },
        },
        quantity: 1,
      },
    ],
    metadata: { booking_id: booking.id, payment_id: payment.id },
    success_url: `${origin}/${locale}/booking/${booking.id}`,
    cancel_url: `${origin}/${locale}/booking/${booking.id}`,
  });

  if (!session.url) return { error: "generic" };
  redirect(session.url);
}

/** Bank transfer — stays `pending` until an owner/admin confirms receipt (CLAUDE.md §8). */
export async function startBankTransfer(
  locale: Locale,
  bookingId: string,
): Promise<PaymentActionState> {
  const parsed = paymentBookingSchema.safeParse({ bookingId });
  if (!parsed.success) return { error: "invalid" };

  const loaded = await loadPayableBooking(parsed.data.bookingId);
  if ("error" in loaded) return { error: loaded.error };
  const { booking } = loaded;

  const admin = createAdminClient();
  const { error } = await admin.from("payments").insert({
    booking_id: booking.id,
    provider: "bank_transfer",
    status: "pending",
    amount_minor: booking.price_minor,
    currency: booking.currency,
  });
  if (error) return { error: "generic" };

  revalidatePath(`/${locale}/booking/${booking.id}`);
  return {};
}

export interface ConfirmBankTransferResult {
  error?: "unauthenticated" | "forbidden" | "generic";
}

/** Owner/admin marks a bank transfer as received — the only other path (besides the
 * Stripe webhook) allowed to move a payment to `succeeded` (CLAUDE.md §8). */
export async function confirmBankTransferPayment(
  locale: Locale,
  paymentId: string,
): Promise<ConfirmBankTransferResult> {
  const parsed = confirmBankTransferSchema.safeParse({ paymentId });
  if (!parsed.success) return { error: "generic" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "unauthenticated" };

  // RLS's payments_read policy already scopes this to the booking's client, the vessel
  // owner, or an admin — but a client reading their own payment isn't allowed to confirm it,
  // so ownership/role still needs an explicit check below.
  const { data: payment, error: readError } = await supabase
    .from("payments")
    .select("id, booking_id, amount_minor, status, provider, bookings ( vessels ( owner_id ) )")
    .eq("id", parsed.data.paymentId)
    .maybeSingle();
  if (readError || !payment) return { error: "generic" };
  if (payment.provider !== "bank_transfer" || payment.status !== "pending") {
    return { error: "generic" };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  const isOwner = payment.bookings?.vessels?.owner_id === user.id;
  const isAdmin = profile?.role === "admin";
  if (!isOwner && !isAdmin) return { error: "forbidden" };

  const admin = createAdminClient();
  const commissionRate = await getPlatformCommissionRate(admin);
  const feeMinor = calculatePlatformFee(payment.amount_minor, commissionRate);

  const { error: paymentUpdateError } = await admin
    .from("payments")
    .update({ status: "succeeded", platform_fee_minor: feeMinor })
    .eq("id", payment.id);
  if (paymentUpdateError) return { error: "generic" };

  const { error: bookingUpdateError } = await admin
    .from("bookings")
    .update({ status: "paid" })
    .eq("id", payment.booking_id);
  if (bookingUpdateError) return { error: "generic" };

  revalidatePath(`/${locale}/owner/bookings`);
  revalidatePath(`/${locale}/owner/finance`);
  return {};
}
