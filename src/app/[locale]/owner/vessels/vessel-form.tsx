"use client";

import { useActionState, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/routing";
import { createVessel, updateVessel, type VesselActionState } from "@/server/actions/vessels";
import { vesselTypeValues } from "@/lib/validation/search";
import {
  vesselStatusValues,
  vesselImageAllowedTypes,
  vesselImageMaxCount,
} from "@/lib/validation/vessel";
import { currencyCodes } from "@/lib/currencies";
import type { SearchLocation, LocalizedText } from "@/server/queries/vessels";
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

function locationLabel(location: SearchLocation, locale: Locale): string {
  const country = (location.country as LocalizedText)[locale] ?? "";
  const city = (location.city as LocalizedText)[locale] ?? "";
  return [city, country].filter(Boolean).join(", ");
}

/** Best-effort place label for a dropped pin — free OSM service, no API key. */
async function reverseGeocodePoint(
  latitude: number,
  longitude: number,
  locale: string,
): Promise<string | null> {
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("lat", String(latitude));
  url.searchParams.set("lon", String(longitude));
  url.searchParams.set("zoom", "14");
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

/** Best-effort coordinates for a typed place name — free OSM service, no API key. */
async function forwardGeocodePoint(
  query: string,
  locale: string,
): Promise<{ lat: number; lng: number } | null> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "1");
  url.searchParams.set("accept-language", locale);

  const response = await fetch(url);
  if (!response.ok) return null;
  const results = await response.json();
  const first = results[0];
  if (!first) return null;
  return { lat: Number(first.lat), lng: Number(first.lon) };
}

const initialState: VesselActionState = {};
const NO_LOCATION = "__none__";

export function VesselForm({
  mode,
  vesselId,
  locations,
  defaultValues,
}: {
  mode: "create" | "edit";
  vesselId?: string;
  locations: SearchLocation[];
  defaultValues?: {
    name: string;
    slug: string;
    type: string;
    locationId: string;
    descriptionRu: string;
    descriptionEn: string;
    lengthMeters: number;
    cabins: number;
    guestsCapacity: number;
    yearBuilt: number | null;
    basePrice: number;
    currency: string;
    status: string;
    latitude: number | null;
    longitude: number | null;
  };
}) {
  const t = useTranslations("owner.vessels.form");
  const tTypes = useTranslations("vessels.types");
  const tStatus = useTranslations("owner.vessels.status");
  const locale = useLocale() as Locale;
  const currencyNames = new Intl.DisplayNames([locale], { type: "currency" });

  const action = mode === "create" ? createVessel.bind(null, locale) : updateVessel.bind(null, locale, vesselId!);
  const [state, formAction, isPending] = useActionState(action, initialState);

  const [locationId, setLocationId] = useState(defaultValues?.locationId);
  const selectedLocation = locations.find((location) => location.id === locationId);
  const [additionalPhotosError, setAdditionalPhotosError] = useState(false);

  // The map pin can be moved two ways: the owner types a new location (forward-geocoded
  // below) or drops a pin directly (reverse-geocoded back into the text field). Either one
  // re-mounts LocationPicker at the resolved point via `mapKey`, matching how it already
  // treats `initialLatitude`/`initialLongitude` as a fresh manual pin on mount.
  const [pinOverride, setPinOverride] = useState<{ lat: number; lng: number } | null>(null);
  const [mapKey, setMapKey] = useState(0);
  const newLocationInputRef = useRef<HTMLInputElement>(null);
  // Guards against an earlier geocode call resolving after a later, newer one.
  const geocodeRequestRef = useRef(0);

  const initialSelectedLocation = locations.find(
    (location) => location.id === defaultValues?.locationId,
  );
  const initialLocationLabel = initialSelectedLocation
    ? locationLabel(initialSelectedLocation, locale)
    : "";

  function handleSelectLocation(value: string) {
    const next = value === NO_LOCATION ? undefined : value;
    setLocationId(next);
    setPinOverride(null);
    setMapKey((key) => key + 1);
    const location = locations.find((candidate) => candidate.id === next);
    if (newLocationInputRef.current) {
      newLocationInputRef.current.value = location ? locationLabel(location, locale) : "";
    }
  }

  async function handleNewLocationBlur() {
    const value = newLocationInputRef.current?.value.trim();
    if (!value) return;
    const requestId = ++geocodeRequestRef.current;
    try {
      const point = await forwardGeocodePoint(value, locale);
      if (point && requestId === geocodeRequestRef.current) {
        setPinOverride(point);
        setMapKey((key) => key + 1);
      }
    } catch {
      // Best-effort convenience — the owner can still drop the pin manually.
    }
  }

  async function handlePin(latitude: number, longitude: number) {
    setLocationId(undefined);
    const requestId = ++geocodeRequestRef.current;
    try {
      const label = await reverseGeocodePoint(latitude, longitude, locale);
      if (label && requestId === geocodeRequestRef.current && newLocationInputRef.current) {
        newLocationInputRef.current.value = label;
      }
    } catch {
      // Best-effort convenience — latitude/longitude are already captured either way.
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-soft md:p-8">
      <form action={formAction} className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="name">{t("name")}</Label>
          <Input id="name" name="name" defaultValue={defaultValues?.name} required />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="slug">{t("slug")}</Label>
          <Input
            id="slug"
            name="slug"
            defaultValue={defaultValues?.slug}
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            required
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label>{t("type")}</Label>
          <Select name="type" defaultValue={defaultValues?.type}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder={t("type")} />
            </SelectTrigger>
            <SelectContent>
              {vesselTypeValues.map((value) => (
                <SelectItem key={value} value={value}>
                  {tTypes(value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-2">
          <Label>{t("location")}</Label>
          <Select value={locationId ?? NO_LOCATION} onValueChange={handleSelectLocation}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder={t("location")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_LOCATION}>{t("newLocationOption")}</SelectItem>
              {locations.map((location) => (
                <SelectItem key={location.id} value={location.id}>
                  {locationLabel(location, locale)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <input type="hidden" name="locationId" value={locationId ?? ""} />
          <Input
            ref={newLocationInputRef}
            name="newLocationName"
            defaultValue={initialLocationLabel}
            placeholder={t("newLocationPlaceholder")}
            onChange={() => setLocationId(undefined)}
            onBlur={handleNewLocationBlur}
          />
          <p className="text-xs font-light text-muted-foreground">{t("newLocationHint")}</p>
        </div>

        {mode === "create" && (
          <div className="flex flex-col gap-2 sm:col-span-2">
            <Label htmlFor="mainPhoto">{t("mainPhoto")}</Label>
            <Input
              id="mainPhoto"
              name="mainPhoto"
              type="file"
              accept={vesselImageAllowedTypes.join(",")}
              required
            />
            <Label htmlFor="additionalPhotos" className="mt-2">
              {t("additionalPhotos")}
            </Label>
            <Input
              id="additionalPhotos"
              name="additionalPhotos"
              type="file"
              accept={vesselImageAllowedTypes.join(",")}
              multiple
              onChange={(event) =>
                setAdditionalPhotosError(
                  (event.target.files?.length ?? 0) > vesselImageMaxCount - 1,
                )
              }
            />
            <p className="text-xs font-light text-muted-foreground">{t("photosHint")}</p>
            {additionalPhotosError && (
              <p className="text-sm text-destructive">{t("errors.maxImages")}</p>
            )}
          </div>
        )}

        <div className="flex flex-col gap-2 sm:col-span-2">
          <Label>{t("mapPin")}</Label>
          <LocationPicker
            key={mapKey}
            latName="latitude"
            lngName="longitude"
            initialLatitude={pinOverride?.lat ?? defaultValues?.latitude}
            initialLongitude={pinOverride?.lng ?? defaultValues?.longitude}
            fallbackLatitude={selectedLocation?.latitude}
            fallbackLongitude={selectedLocation?.longitude}
            hint={t("mapPinHint")}
            onChange={handlePin}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="descriptionRu">{t("descriptionRu")}</Label>
          <Textarea
            id="descriptionRu"
            name="descriptionRu"
            defaultValue={defaultValues?.descriptionRu}
            rows={4}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="descriptionEn">{t("descriptionEn")}</Label>
          <Textarea
            id="descriptionEn"
            name="descriptionEn"
            defaultValue={defaultValues?.descriptionEn}
            rows={4}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="lengthMeters">{t("lengthMeters")}</Label>
          <Input
            id="lengthMeters"
            name="lengthMeters"
            type="number"
            step="0.1"
            min="0"
            defaultValue={defaultValues?.lengthMeters}
            required
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="yearBuilt">{t("yearBuilt")}</Label>
          <Input
            id="yearBuilt"
            name="yearBuilt"
            type="number"
            min="1900"
            max="2100"
            defaultValue={defaultValues?.yearBuilt ?? undefined}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="cabins">{t("cabins")}</Label>
          <Input
            id="cabins"
            name="cabins"
            type="number"
            min="0"
            defaultValue={defaultValues?.cabins}
            required
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="guestsCapacity">{t("guestsCapacity")}</Label>
          <Input
            id="guestsCapacity"
            name="guestsCapacity"
            type="number"
            min="1"
            defaultValue={defaultValues?.guestsCapacity}
            required
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="basePrice">{t("basePrice")}</Label>
          <Input
            id="basePrice"
            name="basePrice"
            type="number"
            step="0.01"
            min="0"
            defaultValue={defaultValues?.basePrice}
            required
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="currency">{t("currency")}</Label>
          <Select name="currency" defaultValue={defaultValues?.currency ?? "USD"}>
            <SelectTrigger id="currency" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {currencyCodes.map((code) => (
                <SelectItem key={code} value={code}>
                  {code} — {currencyNames.of(code)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-2">
          <Label>{t("status")}</Label>
          <Select name="status" defaultValue={defaultValues?.status ?? "draft"}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {vesselStatusValues.map((value) => (
                <SelectItem key={value} value={value}>
                  {tStatus(value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {state.error && (
          <p className="text-sm text-destructive sm:col-span-2">{t(`errors.${state.error}`)}</p>
        )}

        <Button
          type="submit"
          size="lg"
          disabled={isPending || additionalPhotosError}
          className="rounded-full sm:col-span-2 sm:w-fit"
        >
          {mode === "create" ? t("create") : t("save")}
        </Button>
      </form>
    </div>
  );
}
