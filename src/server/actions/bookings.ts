"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createBookingSchema, ownerBookingStatusSchema } from "@/lib/validation/booking";
import { calculateBookingPrice } from "@/lib/pricing/calculate";
import { isRangeAvailable } from "@/lib/availability/ranges";
import { toDateRangeLiteral } from "@/lib/supabase/date-range";
import { getVesselBookingContext } from "@/server/queries/availability";
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
  error?: "unauthenticated" | "invalid" | "generic";
}

/** Owner-facing: RLS's bookings_update policy (client, vessel owner, or admin) is the actual gate. */
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

  const { error } = await supabase
    .from("bookings")
    .update({ status: parsed.data.status })
    .eq("id", parsed.data.bookingId);
  if (error) return { error: "generic" };

  revalidatePath(`/${locale}/owner/bookings`);
  return {};
}
