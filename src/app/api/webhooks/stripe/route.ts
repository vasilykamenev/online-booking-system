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

  if (event.type === "checkout.session.completed") {
    await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
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
