import "server-only";

interface BilingualLabel {
  ru: string;
  en: string;
  // Structural match for the generated `Json` type (Supabase's jsonb columns)
  // so callers can insert this directly without an extra cast.
  [key: string]: string;
}

async function reverseGeocodeOnce(
  latitude: number,
  longitude: number,
  locale: "ru" | "en",
): Promise<{ city?: string; country?: string } | null> {
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("lat", String(latitude));
  url.searchParams.set("lon", String(longitude));
  url.searchParams.set("zoom", "10");
  url.searchParams.set("accept-language", locale);

  const response = await fetch(url, {
    // Nominatim's usage policy requires a way to identify the calling application.
    headers: { "User-Agent": "MeridianBeyond/1.0 (https://meridian.travel)" },
  });
  if (!response.ok) return null;
  const data = await response.json();
  const address = data.address ?? {};
  return {
    city: address.city ?? address.town ?? address.village ?? address.county ?? address.state,
    country: address.country,
  };
}

/**
 * Best-effort {ru,en} city/country for a dropped pin, used to seed a new
 * `locations` catalog row when an owner types a marina that isn't in the catalog
 * yet. Returns null if either locale's lookup fails to resolve both fields —
 * `locations.country`/`city` are NOT NULL, so a partial result can't be stored.
 */
export async function reverseGeocodeBilingual(
  latitude: number,
  longitude: number,
): Promise<{ city: BilingualLabel; country: BilingualLabel } | null> {
  const [ru, en] = await Promise.all([
    reverseGeocodeOnce(latitude, longitude, "ru"),
    reverseGeocodeOnce(latitude, longitude, "en"),
  ]);
  if (!ru?.city || !ru.country || !en?.city || !en.country) return null;

  return {
    city: { ru: ru.city, en: en.city },
    country: { ru: ru.country, en: en.country },
  };
}
