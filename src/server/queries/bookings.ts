import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import { parseDateRangeLiteral } from "@/lib/supabase/date-range";

export interface BookingDetail {
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

/** RLS scopes reads to the booking's own client, the vessel owner, or an admin — anyone else gets `null`. */
export async function getBookingById(id: string): Promise<BookingDetail | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("bookings")
    .select(
      `id, date_range, guests_count, status, price_minor, currency, created_at,
       vessels ( slug, name, vessel_images ( url, sort_order ) )`,
    )
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const images = [...(data.vessels?.vessel_images ?? [])].sort(
    (a, b) => a.sort_order - b.sort_order,
  );

  return {
    id: data.id,
    vesselSlug: data.vessels?.slug ?? "",
    vesselName: data.vessels?.name ?? "",
    vesselImageUrl: images[0]?.url ?? null,
    dateRange: parseDateRangeLiteral(data.date_range as string),
    guestsCount: data.guests_count,
    status: data.status,
    priceMinor: data.price_minor,
    currency: data.currency,
    createdAt: data.created_at,
  };
}
