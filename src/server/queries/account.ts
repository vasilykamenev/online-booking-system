import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import { CARD_COLUMNS, mapCardRow, type CardRow, type FeaturedVessel } from "./vessels";

export async function getFavoriteVessels(profileId: string): Promise<FeaturedVessel[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("favorites")
    .select(`vessel_id, vessels ( ${CARD_COLUMNS} )`)
    .eq("profile_id", profileId)
    .order("created_at", { ascending: false });

  if (error) throw error;

  return (data ?? [])
    .map((row) => row.vessels as CardRow | null)
    .filter((vessel): vessel is CardRow => vessel !== null)
    .map(mapCardRow);
}

export async function getFavoriteVesselIds(profileId: string): Promise<Set<string>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("favorites")
    .select("vessel_id")
    .eq("profile_id", profileId);

  if (error) throw error;
  return new Set((data ?? []).map((row) => row.vessel_id));
}

export async function isVesselFavorited(profileId: string, vesselId: string): Promise<boolean> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("favorites")
    .select("id")
    .eq("profile_id", profileId)
    .eq("vessel_id", vesselId)
    .maybeSingle();

  if (error) throw error;
  return data !== null;
}

export interface BookingHistoryItem {
  id: string;
  vesselSlug: string;
  vesselName: string;
  vesselImageUrl: string | null;
  dateRange: { start: string; end: string };
  guestsCount: number;
  status: Database["public"]["Enums"]["booking_status"];
  priceMinor: number;
  currency: string;
  createdAt: string;
}

/** Postgres daterange text form is "[2026-08-01,2026-08-07)" — bounds are always present for our bookings. */
function parseDateRange(raw: string): { start: string; end: string } {
  const [start, end] = raw.replace(/[[\])]/g, "").split(",");
  return { start, end };
}

export async function getBookingHistory(clientId: string): Promise<BookingHistoryItem[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("bookings")
    .select(
      `id, date_range, guests_count, status, price_minor, currency, created_at,
       vessels ( slug, name, vessel_images ( url, sort_order ) )`,
    )
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });

  if (error) throw error;

  return (data ?? []).map((booking) => {
    const images = [...(booking.vessels?.vessel_images ?? [])].sort(
      (a, b) => a.sort_order - b.sort_order,
    );

    return {
      id: booking.id,
      vesselSlug: booking.vessels?.slug ?? "",
      vesselName: booking.vessels?.name ?? "",
      vesselImageUrl: images[0]?.url ?? null,
      dateRange: parseDateRange(booking.date_range as string),
      guestsCount: booking.guests_count,
      status: booking.status,
      priceMinor: booking.price_minor,
      currency: booking.currency,
      createdAt: booking.created_at,
    };
  });
}
