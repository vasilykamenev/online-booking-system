"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createBookingSchema,
  ownerBookingStatusSchema,
  selectBookingPaymentMethodSchema,
} from "@/lib/validation/booking";
import { calculateBookingPrice } from "@/lib/pricing/calculate";
import { isRangeAvailable } from "@/lib/availability/ranges";
import { toDateRangeLiteral, parseDateRangeLiteral } from "@/lib/supabase/date-range";
import { getVesselBookingContext } from "@/server/queries/availability";
import { canOwnerConfirm, canSelectPaymentMethod } from "@/lib/booking/payment-flow";
import { sendBookingMessage } from "@/server/actions/bookings-messages";
import type { Locale } from "@/i18n/routing";

export interface CreateBookingInput {
  vesselId: string;
  checkIn: string;
  checkOut: string;
  guestsCount: number;
}

export interface CreateBookingResult {
  bookingId?: string;
  error?: "unauthenticated" | "invalid" | "unavailable" | "guestsExceeded" | "generic";
}

export async function createBooking(input: CreateBookingInput): Promise<CreateBookingResult> {
  const parsed = createBookingSchema.safeParse(input);
  if (!parsed.success) return { error: "invalid" };
  const { vesselId, checkIn, checkOut, guestsCount } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "unauthenticated" };

  const today = new Date().toISOString().slice(0, 10);
  if (checkIn < today) return { error: "invalid" };

  const { data: vessel, error: vesselError } = await supabase
    .from("vessels")
    .select("id, base_price_minor, currency, guests_capacity")
    .eq("id", vesselId)
    .eq("status", "published")
    .maybeSingle();
  if (vesselError) return { error: "generic" };
  if (!vessel) return { error: "invalid" };
  if (guestsCount > vessel.guests_capacity) return { error: "guestsExceeded" };

  // Price and availability are always recomputed server-side — never trust a client-sent total.
  const { pricingRules, unavailableRanges } = await getVesselBookingContext(vessel.id);
  if (!isRangeAvailable({ start: checkIn, end: checkOut }, unavailableRanges)) {
    return { error: "unavailable" };
  }

  const { totalMinor } = calculateBookingPrice(
    checkIn,
    checkOut,
    vessel.base_price_minor,
    pricingRules,
  );

  const { data: booking, error: insertError } = await supabase
    .from("bookings")
    .insert({
      vessel_id: vessel.id,
      client_id: user.id,
      date_range: toDateRangeLiteral(checkIn, checkOut),
      guests_count: guestsCount,
      price_minor: totalMinor,
      currency: vessel.currency,
    })
    .select("id")
    .single();

  if (insertError) {
    // exclusion_violation: another booking won the race between our availability check and this insert.
    if (insertError.code === "23P01") return { error: "unavailable" };
    return { error: "generic" };
  }

  revalidatePath("/", "layout");
  return { bookingId: booking.id };
}

export interface UpdateBookingStatusResult {
  error?: "unauthenticated" | "invalid" | "paymentMethodMissing" | "generic";
}

/** Owner-facing: RLS's bookings_update policy (client, vessel owner, or admin) is the actual gate,
 * plus the `protect_booking_mutation` trigger (pending -> confirmed requires a declared payment
 * method). The checks here just turn that into a typed error instead of a raw SQL exception. */
export async function updateBookingStatus(
  locale: Locale,
  bookingId: string,
  status: "confirmed" | "cancelled",
): Promise<UpdateBookingStatusResult> {
  const parsed = ownerBookingStatusSchema.safeParse({ bookingId, status });
  if (!parsed.success) return { error: "invalid" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "unauthenticated" };

  const { data: booking, error: readError } = await supabase
    .from("bookings")
    .select("status, payment_method, client_id, date_range, vessels ( name )")
    .eq("id", parsed.data.bookingId)
    .maybeSingle();
  if (readError || !booking) return { error: "generic" };

  if (parsed.data.status === "confirmed" && !canOwnerConfirm(booking.status, booking.payment_method)) {
    return { error: "paymentMethodMissing" };
  }

  const { error } = await supabase
    .from("bookings")
    .update({ status: parsed.data.status })
    .eq("id", parsed.data.bookingId);
  if (error) return { error: "generic" };

  if (parsed.data.status === "confirmed" && booking.payment_method) {
    const t = await getTranslations({ locale, namespace: "booking.systemMessages" });
    const { start, end } = parseDateRangeLiteral(booking.date_range as string);
    await sendBookingMessage(supabase, {
      fromId: user.id,
      toId: booking.client_id,
      body: t("ownerConfirmed", {
        vesselName: booking.vessels?.name ?? "",
        method: t(`method.${booking.payment_method}`),
        checkIn: start,
        checkOut: end,
      }),
    });
  }

  revalidatePath(`/${locale}/owner/bookings`);
  revalidatePath(`/${locale}/booking/${parsed.data.bookingId}`);
  return {};
}

export interface SelectBookingPaymentMethodResult {
  error?: "unauthenticated" | "invalid" | "forbidden" | "invalidStatus" | "generic";
}

/** Client declares (or changes) the payment method for a booking. First declaration sends
 * the owner a request to confirm; changing it after the owner already confirmed reverts the
 * booking to `pending` and restarts the confirmation handshake. */
export async function selectBookingPaymentMethod(
  locale: Locale,
  bookingId: string,
  method: "stripe" | "bank_transfer",
): Promise<SelectBookingPaymentMethodResult> {
  const parsed = selectBookingPaymentMethodSchema.safeParse({ bookingId, method });
  if (!parsed.success) return { error: "invalid" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "unauthenticated" };

  const { data: booking, error: readError } = await supabase
    .from("bookings")
    .select("status, client_id, payment_method, date_range, vessels ( name, owner_id )")
    .eq("id", parsed.data.bookingId)
    .maybeSingle();
  if (readError || !booking) return { error: "generic" };
  if (booking.client_id !== user.id) return { error: "forbidden" };
  if (!canSelectPaymentMethod(booking.status)) return { error: "invalidStatus" };
  if (!booking.vessels?.owner_id) return { error: "generic" };

  const wasConfirmed = booking.status === "confirmed";
  if (booking.payment_method === parsed.data.method && !wasConfirmed) return {};

  // Reverting a confirmed booking back to `pending` isn't a transition the client's own
  // session is allowed (protect_booking_mutation), so the system-triggered revert goes
  // through the service-role client, same as the payment-write paths in payments.ts.
  const admin = createAdminClient();
  const { error: updateError } = await admin
    .from("bookings")
    .update({ payment_method: parsed.data.method, ...(wasConfirmed ? { status: "pending" } : {}) })
    .eq("id", parsed.data.bookingId);
  if (updateError) return { error: "generic" };

  const t = await getTranslations({ locale, namespace: "booking.systemMessages" });
  const { start, end } = parseDateRangeLiteral(booking.date_range as string);
  await sendBookingMessage(supabase, {
    fromId: user.id,
    toId: booking.vessels.owner_id,
    body: t(wasConfirmed ? "paymentMethodChanged" : "paymentMethodProposed", {
      vesselName: booking.vessels.name,
      method: t(`method.${parsed.data.method}`),
      checkIn: start,
      checkOut: end,
    }),
  });

  revalidatePath(`/${locale}/booking/${parsed.data.bookingId}`);
  revalidatePath(`/${locale}/owner/bookings`);
  return {};
}
