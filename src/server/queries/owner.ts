import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import { parseDateRangeLiteral } from "@/lib/supabase/date-range";
import type { LocalizedText } from "./vessels";
import type { BookingPaymentInfo } from "./bookings";

export interface OwnerVesselListItem {
  id: string;
  slug: string;
  name: string;
  type: Database["public"]["Enums"]["vessel_type"];
  status: Database["public"]["Enums"]["vessel_status"];
  basePriceMinor: number;
  currency: string;
  guestsCapacity: number;
  imageUrl: string | null;
}

export async function getOwnerVessels(ownerId: string): Promise<OwnerVesselListItem[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("vessels")
    .select(
      `id, slug, name, type, status, base_price_minor, currency, guests_capacity,
       vessel_images ( url, sort_order )`,
    )
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false });

  if (error) throw error;

  return (data ?? []).map((vessel) => {
    const image = [...vessel.vessel_images].sort((a, b) => a.sort_order - b.sort_order)[0];
    return {
      id: vessel.id,
      slug: vessel.slug,
      name: vessel.name,
      type: vessel.type,
      status: vessel.status,
      basePriceMinor: vessel.base_price_minor,
      currency: vessel.currency,
      guestsCapacity: vessel.guests_capacity,
      imageUrl: image?.url ?? null,
    };
  });
}

export interface OwnerVesselDetail {
  id: string;
  slug: string;
  name: string;
  type: Database["public"]["Enums"]["vessel_type"];
  status: Database["public"]["Enums"]["vessel_status"];
  description: string;
  lengthMeters: number;
  cabins: number;
  guestsCapacity: number;
  yearBuilt: number | null;
  basePriceMinor: number;
  currency: string;
  locationId: string;
  latitude: number | null;
  longitude: number | null;
  images: { id: string; url: string; altText: LocalizedText }[];
  amenityIds: string[];
}

/** Scoped to `ownerId` explicitly (not just RLS) so a mistyped id reads as "not found", not a leak. */
export async function getOwnerVesselDetail(
  ownerId: string,
  vesselId: string,
): Promise<OwnerVesselDetail | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("vessels")
    .select(
      `id, slug, name, type, status, description, length_meters, cabins, guests_capacity,
       year_built, base_price_minor, currency, location_id, latitude, longitude,
       vessel_images ( id, url, alt_text, sort_order ),
       vessel_amenities ( amenity_id )`,
    )
    .eq("id", vesselId)
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return {
    id: data.id,
    slug: data.slug,
    name: data.name,
    type: data.type,
    status: data.status,
    description: data.description,
    lengthMeters: data.length_meters,
    cabins: data.cabins,
    guestsCapacity: data.guests_capacity,
    yearBuilt: data.year_built,
    basePriceMinor: data.base_price_minor,
    currency: data.currency,
    locationId: data.location_id,
    latitude: data.latitude,
    longitude: data.longitude,
    images: [...data.vessel_images]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((image) => ({ id: image.id, url: image.url, altText: (image.alt_text ?? {}) as LocalizedText })),
    amenityIds: data.vessel_amenities.map((row) => row.amenity_id),
  };
}

export interface AvailabilityBlock {
  id: string;
  dateRange: { start: string; end: string };
  reason: string | null;
}

export async function getVesselAvailability(vesselId: string): Promise<AvailabilityBlock[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("availability")
    .select("id, date_range, reason")
    .eq("vessel_id", vesselId)
    .order("date_range");

  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    dateRange: parseDateRangeLiteral(row.date_range as string),
    reason: row.reason,
  }));
}

/** Booked ranges (from `bookings`, read-only here) via the same security-definer RPC the public
 * booking widget uses — availability is public info on a vessel, unlike who booked it. */
export async function getVesselBookedRanges(
  vesselId: string,
): Promise<{ start: string; end: string }[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_vessel_booked_ranges", { p_vessel_id: vesselId });
  if (error) throw error;
  return (data ?? []).map((raw) => parseDateRangeLiteral(raw as string));
}

export interface OwnerPricingRule {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
  priceMinor: number;
  priority: number;
}

export async function getVesselPricingRules(vesselId: string): Promise<OwnerPricingRule[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("pricing_rules")
    .select("id, label, date_range, price_minor, priority")
    .eq("vessel_id", vesselId)
    .order("date_range");

  if (error) throw error;

  return (data ?? []).map((rule) => {
    const { start, end } = parseDateRangeLiteral(rule.date_range as string);
    return {
      id: rule.id,
      label: rule.label,
      startDate: start,
      endDate: end,
      priceMinor: rule.price_minor,
      priority: rule.priority,
    };
  });
}

export interface OwnerBookingItem {
  id: string;
  vesselId: string;
  vesselSlug: string;
  vesselName: string;
  dateRange: { start: string; end: string };
  guestsCount: number;
  status: Database["public"]["Enums"]["booking_status"];
  paymentMethod: Database["public"]["Enums"]["payment_provider"] | null;
  priceMinor: number;
  currency: string;
  createdAt: string;
  latestPayment: BookingPaymentInfo | null;
}

export async function getOwnerBookings(ownerId: string): Promise<OwnerBookingItem[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("bookings")
    .select(
      `id, date_range, guests_count, status, payment_method, price_minor, currency, created_at,
       vessels!inner ( id, slug, name, owner_id ),
       payments ( id, provider, status, amount_minor, currency, failure_reason, created_at )`,
    )
    .eq("vessels.owner_id", ownerId)
    .order("created_at", { ascending: false });

  if (error) throw error;

  return (data ?? []).map((booking) => {
    const latestPayment = [...booking.payments].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    )[0];

    return {
      id: booking.id,
      vesselId: booking.vessels.id,
      vesselSlug: booking.vessels.slug,
      vesselName: booking.vessels.name,
      dateRange: parseDateRangeLiteral(booking.date_range as string),
      guestsCount: booking.guests_count,
      status: booking.status,
      paymentMethod: booking.payment_method,
      priceMinor: booking.price_minor,
      currency: booking.currency,
      createdAt: booking.created_at,
      latestPayment: latestPayment
        ? {
            id: latestPayment.id,
            provider: latestPayment.provider,
            status: latestPayment.status,
            amountMinor: latestPayment.amount_minor,
            currency: latestPayment.currency,
            failureReason: latestPayment.failure_reason,
            createdAt: latestPayment.created_at,
          }
        : null,
    };
  });
}

export interface OwnerFinanceSummary {
  byCurrency: Record<string, { earnedMinor: number; pendingMinor: number }>;
  bookings: OwnerBookingItem[];
}

/** "Earned" = paid/completed bookings; "pending" = still awaiting confirmation or payment. */
export async function getOwnerFinanceSummary(ownerId: string): Promise<OwnerFinanceSummary> {
  const bookings = await getOwnerBookings(ownerId);

  const byCurrency: OwnerFinanceSummary["byCurrency"] = {};
  for (const booking of bookings) {
    if (booking.status === "cancelled") continue;
    byCurrency[booking.currency] ??= { earnedMinor: 0, pendingMinor: 0 };
    if (booking.status === "paid" || booking.status === "completed") {
      byCurrency[booking.currency].earnedMinor += booking.priceMinor;
    } else {
      byCurrency[booking.currency].pendingMinor += booking.priceMinor;
    }
  }

  return { byCurrency, bookings };
}
