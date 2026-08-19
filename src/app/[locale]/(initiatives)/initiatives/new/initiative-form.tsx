"use client";

import { useActionState, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/routing";
import { createInitiative, type InitiativeActionState } from "@/server/actions/initiatives";
import type { SearchLocation } from "@/server/queries/vessels";
import { pickLocalized } from "@/lib/supabase/localized";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { LocationPicker } from "@/components/map/location-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const initialState: InitiativeActionState = {};
const NO_LOCATION = "__none__";

function locationLabel(location: SearchLocation, locale: Locale): string {
  const city = pickLocalized(location.city, locale);
  const country = pickLocalized(location.country, locale);
  return [city, country].filter(Boolean).join(", ");
}

/** Best-effort place name for a dropped pin — free OSM service, no API key. */
async function reverseGeocodeRegion(
  latitude: number,
  longitude: number,
  locale: string,
): Promise<string | null> {
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("lat", String(latitude));
  url.searchParams.set("lon", String(longitude));
  url.searchParams.set("zoom", "10");
  url.searchParams.set("accept-language", locale);

  const response = await fetch(url);
  if (!response.ok) return null;
  const data = await response.json();
  const address = data.address ?? {};
  const place: string | undefined =
    address.city ?? address.town ?? address.village ?? address.county ?? address.state;
  const country: string | undefined = address.country;
  if (place && country) return `${place}, ${country}`;
  return place ?? country ?? null;
}

export function InitiativeForm({ locations }: { locations: SearchLocation[] }) {
  const t = useTranslations("initiativesPage.form");
  const locale = useLocale() as Locale;
  const [state, formAction, isPending] = useActionState(
    createInitiative.bind(null, locale),
    initialState,
  );

  const regionInputRef = useRef<HTMLInputElement>(null);
  // Guards against an earlier reverse-geocode call resolving after a later pin drop.
  const geocodeRequestRef = useRef(0);

  const [locationId, setLocationId] = useState<string | undefined>(undefined);
  const selectedLocation = locations.find((location) => location.id === locationId);

  async function handlePin(latitude: number, longitude: number) {
    const requestId = ++geocodeRequestRef.current;
    try {
      const region = await reverseGeocodeRegion(latitude, longitude, locale);
      if (region && requestId === geocodeRequestRef.current && regionInputRef.current) {
        regionInputRef.current.value = region;
      }
    } catch {
      // Best-effort convenience fill — the field stays manually editable either way.
    }
  }

  function handleSelectLocation(value: string) {
    const next = value === NO_LOCATION ? undefined : value;
    setLocationId(next);
    const location = locations.find((candidate) => candidate.id === next);
    // Known dictionary entry already has its own label — fill Region straight
    // from it instead of round-tripping through reverse geocoding.
    if (location && regionInputRef.current) {
      regionInputRef.current.value = locationLabel(location, locale);
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-soft md:p-8">
      <form action={formAction} className="grid grid-cols-1 gap-5">
        <div className="flex flex-col gap-2">
          <Label htmlFor="title">{t("titleField")}</Label>
          <Input id="title" name="title" required />
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="topic">{t("topic")}</Label>
            <Input id="topic" name="topic" placeholder={t("topicPlaceholder")} required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="region">{t("region")}</Label>
            <Input
              ref={regionInputRef}
              id="region"
              name="region"
              placeholder={t("regionPlaceholder")}
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="activityType">{t("activityType")}</Label>
            <Input
              id="activityType"
              name="activityType"
              placeholder={t("activityTypePlaceholder")}
              required
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="description">{t("description")}</Label>
          <Textarea id="description" name="description" rows={6} required />
        </div>

        <div className="flex flex-col gap-2">
          <Label>{t("existingLocation")}</Label>
          <Select value={locationId ?? NO_LOCATION} onValueChange={handleSelectLocation}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder={t("existingLocationPlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_LOCATION}>{t("existingLocationNone")}</SelectItem>
              {locations.map((location) => (
                <SelectItem key={location.id} value={location.id}>
                  {locationLabel(location, locale)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs font-light text-muted-foreground">
            {t("existingLocationHint")}
          </p>
          <input type="hidden" name="locationId" value={locationId ?? ""} />
        </div>

        <div className="flex flex-col gap-2">
          <Label>{t("mapPin")}</Label>
          <LocationPicker
            latName="latitude"
            lngName="longitude"
            fallbackLatitude={selectedLocation?.latitude}
            fallbackLongitude={selectedLocation?.longitude}
            hint={t("mapPinHint")}
            onChange={handlePin}
          />
        </div>

        {state.error && <p className="text-sm text-destructive">{t(`errors.${state.error}`)}</p>}

        <Button type="submit" size="lg" disabled={isPending} className="rounded-full sm:w-fit">
          {t("submit")}
        </Button>
      </form>
    </div>
  );
}
