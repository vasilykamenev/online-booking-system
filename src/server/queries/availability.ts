import "server-only";
import { createClient } from "@/lib/supabase/server";
import { parseDateRangeLiteral } from "@/lib/supabase/date-range";
import type { PricingRule } from "@/lib/pricing/calculate";
import type { DateInterval } from "@/lib/availability/ranges";

export interface VesselBookingContext {
  pricingRules: PricingRule[];
  unavailableRanges: DateInterval[];
}

/**
 * Booked date ranges come from a security-definer RPC (get_vessel_booked_ranges) rather than
 * a direct `bookings` select: the bookings_read RLS policy only exposes a client's own rows,
 * but availability itself (unlike who booked it) is public information on a published vessel.
 */
export async function getVesselBookingContext(vesselId: string): Promise<VesselBookingContext> {
  const supabase = await createClient();

  const [pricingResult, blockedResult, bookedResult] = await Promise.all([
    supabase
      .from("pricing_rules")
      .select("date_range, price_minor, priority")
      .eq("vessel_id", vesselId),
    supabase.from("availability").select("date_range").eq("vessel_id", vesselId),
    supabase.rpc("get_vessel_booked_ranges", { p_vessel_id: vesselId }),
  ]);

  if (pricingResult.error) throw pricingResult.error;
  if (blockedResult.error) throw blockedResult.error;
  if (bookedResult.error) throw bookedResult.error;

  const pricingRules: PricingRule[] = (pricingResult.data ?? []).map((rule) => {
    const { start, end } = parseDateRangeLiteral(rule.date_range as string);
    return { startDate: start, endDate: end, priceMinor: rule.price_minor, priority: rule.priority };
  });

  const blockedRanges = (blockedResult.data ?? []).map((row) =>
    parseDateRangeLiteral(row.date_range as string),
  );
  const bookedRanges = (bookedResult.data ?? []).map((raw) => parseDateRangeLiteral(raw));

  return { pricingRules, unavailableRanges: [...blockedRanges, ...bookedRanges] };
}
