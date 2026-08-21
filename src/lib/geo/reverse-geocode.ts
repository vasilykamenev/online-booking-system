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

  try {
    const response = await fetch(url, {
      // Nominatim's usage policy requires a way to identify the calling application.
      headers: { "User-Agent": "MeridianBeyond/1.0 (https://meridian.travel)" },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;
    const data = await response.json();
    const address = data.address ?? {};
    return {
      city: address.city ?? address.town ?? address.village ?? address.county ?? address.state,
      country: address.country,
    };
  } catch (error) {
    // Network failure, timeout, or a malformed response from the geocoding service — treated
    // the same as "couldn't resolve" by the caller. Must not throw: this runs inside a Server
    // Action, and an uncaught error here would trip the route's error boundary and blow away
    // whatever the owner had typed into the registration form.
    console.error("[reverseGeocodeOnce] geocoding request failed", { latitude, longitude, locale, error });
    return null;
  }
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
