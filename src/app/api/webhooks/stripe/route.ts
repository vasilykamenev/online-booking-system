import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripeClient } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { calculatePlatformFee } from "@/lib/pricing/commission";
import { getPlatformCommissionRate } from "@/server/queries/admin";

/** Booking confirmation happens only here, never on the user's checkout redirect (CLAUDE.md §8). */
export async function POST(request: Request): Promise<NextResponse> {
  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "missing signature" }, { status: 400 });

  const body = await request.text();
  let event: Stripe.Event;
  try {
    event = getStripeClient().webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!,
    );
  } catch {
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  switch (event.type) {
    case "checkout.session.completed":
      await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
      break;
    case "checkout.session.expired":
      await handleCheckoutExpired(event.data.object as Stripe.Checkout.Session);
      break;
    case "payment_intent.payment_failed":
      await handlePaymentIntentFailed(event.data.object as Stripe.PaymentIntent);
      break;
  }

  return NextResponse.json({ received: true });
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const paymentId = session.metadata?.payment_id;
  const bookingId = session.metadata?.booking_id;
  if (!paymentId || !bookingId) return;

  const admin = createAdminClient();

  // Idempotent: Stripe can redeliver the same event, so only act while still `pending`.
  const { data: payment } = await admin
    .from("payments")
    .select("status, amount_minor")
    .eq("id", paymentId)
    .maybeSingle();
  if (!payment || payment.status !== "pending") return;

  const externalReference =
    typeof session.payment_intent === "string" ? session.payment_intent : session.id;
  const commissionRate = await getPlatformCommissionRate(admin);

  await admin
    .from("payments")
    .update({
      status: "succeeded",
      external_reference: externalReference,
      platform_fee_minor: calculatePlatformFee(payment.amount_minor, commissionRate),
    })
    .eq("id", paymentId);

  await admin.from("bookings").update({ status: "paid" }).eq("id", bookingId);
}

/** The client never returned to complete the Stripe Checkout page in time — a gateway-driven
 * failure, distinct from the client explicitly cancelling (see `cancelPendingPayment`). */
async function handleCheckoutExpired(session: Stripe.Checkout.Session): Promise<void> {
  const paymentId = session.metadata?.payment_id;
  if (!paymentId) return;

  const admin = createAdminClient();
  const { data: payment } = await admin
    .from("payments")
    .select("status")
    .eq("id", paymentId)
    .maybeSingle();
  if (!payment || payment.status !== "pending") return;

  await admin
    .from("payments")
    .update({
      status: "failed",
      failure_code: "session_expired",
      failure_reason: "Оплата не была завершена вовремя — сессия оплаты истекла.",
    })
    .eq("id", paymentId);
}

/** The card was declined or otherwise rejected by the issuer/gateway — surfaced to both the
 * payer and the payee, with the reason Stripe gave, via `payments.failure_reason`. */
async function handlePaymentIntentFailed(paymentIntent: Stripe.PaymentIntent): Promise<void> {
  const paymentId = paymentIntent.metadata?.payment_id;
  if (!paymentId) return;

  const admin = createAdminClient();
  const { data: payment } = await admin
    .from("payments")
    .select("status")
    .eq("id", paymentId)
    .maybeSingle();
  if (!payment || payment.status !== "pending") return;

  await admin
    .from("payments")
    .update({
      status: "failed",
      failure_code: paymentIntent.last_payment_error?.code ?? null,
      failure_reason: paymentIntent.last_payment_error?.message ?? "Платёж отклонён платёжной системой.",
    })
    .eq("id", paymentId);
}
