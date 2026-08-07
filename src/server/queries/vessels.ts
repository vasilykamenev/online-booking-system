import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

type LocalizedText = Partial<Record<"ru" | "en", string>>;

export interface FeaturedVessel {
  id: string;
  slug: string;
  type: Database["public"]["Enums"]["vessel_type"];
  name: string;
  ratingAvg: number;
  guestsCapacity: number;
  cabins: number;
  basePriceMinor: number;
  currency: string;
  country: LocalizedText;
  city: LocalizedText;
  image: { url: string; alt: LocalizedText } | null;
}

export async function getFeaturedVessels(limit = 4): Promise<FeaturedVessel[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("vessels")
    .select(
      `id, slug, type, name, rating_avg, guests_capacity, cabins, base_price_minor, currency,
       locations ( country, city ),
       vessel_images ( url, alt_text, sort_order )`,
    )
    .eq("status", "published")
    .order("rating_avg", { ascending: false })
    .limit(limit);

  if (error) throw error;

  return (data ?? []).map((vessel) => {
    const image = [...vessel.vessel_images].sort((a, b) => a.sort_order - b.sort_order)[0];

    return {
      id: vessel.id,
      slug: vessel.slug,
      type: vessel.type,
      name: vessel.name,
      ratingAvg: vessel.rating_avg,
      guestsCapacity: vessel.guests_capacity,
      cabins: vessel.cabins,
      basePriceMinor: vessel.base_price_minor,
      currency: vessel.currency,
      country: (vessel.locations?.country ?? {}) as LocalizedText,
      city: (vessel.locations?.city ?? {}) as LocalizedText,
      image: image ? { url: image.url, alt: (image.alt_text ?? {}) as LocalizedText } : null,
    };
  });
}
