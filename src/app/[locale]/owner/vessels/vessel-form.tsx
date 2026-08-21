"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/routing";
import { Link } from "@/i18n/navigation";
import { createVessel, updateVessel, type VesselActionState } from "@/server/actions/vessels";
import { clearSessionDraft, readSessionDraft, writeSessionDraft } from "@/lib/storage/session-draft";
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

interface VesselFormFields {
  name: string;
  slug: string;
  type: string;
  newLocationName: string;
  descriptionRu: string;
  descriptionEn: string;
  lengthMeters: string;
  yearBuilt: string;
  cabins: string;
  guestsCapacity: string;
  basePrice: string;
  currency: string;
  status: string;
}

/** Everything needed to fully reconstruct the form's editable state after a remount. */
interface VesselFormDraft {
  fields: VesselFormFields;
  locationId?: string;
  pinOverride: { lat: number; lng: number } | null;
  mainPhotoName: string | null;
  additionalPhotoNames: string[];
}

// Long enough to survive an owner clicking "Try again" (or refreshing) moments after an error,
// short enough that a genuinely abandoned draft doesn't resurface days later on an unrelated visit.
const DRAFT_TTL_MS = 15 * 60 * 1000;

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

  const draftKey = mode === "create" ? "vessel-form-draft:new" : `vessel-form-draft:${vesselId}`;
  // A same-tab draft saved just before an unexpected error — e.g. the owner/error.tsx boundary's
  // "Try again" button remounts this form from scratch after a Server Action threw. Read once via
  // the lazy `useState` initializers below (not an effect) so the very first client render already
  // has the restored values, with no extra render pass or setState-during-effect.
  const [initialDraft] = useState(() => readSessionDraft<VesselFormDraft>(draftKey, DRAFT_TTL_MS));

  const initialSelectedLocation = locations.find(
    (location) => location.id === defaultValues?.locationId,
  );
  const initialLocationLabel = initialSelectedLocation
    ? locationLabel(initialSelectedLocation, locale)
    : "";

  // React resets uncontrolled form fields (via requestFormReset) after every Server
  // Action submission, success or failure — so on validation errors the owner would
  // otherwise see their typed data vanish. Keeping every field in React state instead
  // of relying on `defaultValue` sidesteps that: state survives the reset because
  // React re-syncs controlled `value` props on the next render regardless of what the
  // native reset did to the DOM.
  const [fields, setFields] = useState<VesselFormFields>(
    () =>
      initialDraft?.fields ?? {
        name: defaultValues?.name ?? "",
        slug: defaultValues?.slug ?? "",
        type: defaultValues?.type ?? "",
        newLocationName: initialLocationLabel,
        descriptionRu: defaultValues?.descriptionRu ?? "",
        descriptionEn: defaultValues?.descriptionEn ?? "",
        lengthMeters: defaultValues?.lengthMeters?.toString() ?? "",
        yearBuilt: defaultValues?.yearBuilt?.toString() ?? "",
        cabins: defaultValues?.cabins?.toString() ?? "",
        guestsCapacity: defaultValues?.guestsCapacity?.toString() ?? "",
        basePrice: defaultValues?.basePrice?.toString() ?? "",
        currency: defaultValues?.currency ?? "USD",
        status: defaultValues?.status ?? "draft",
      },
  );
  function setField<K extends keyof typeof fields>(key: K, value: (typeof fields)[K]) {
    setFields((prev) => ({ ...prev, [key]: value }));
  }

  const [locationId, setLocationId] = useState(initialDraft?.locationId ?? defaultValues?.locationId);
  const selectedLocation = locations.find((location) => location.id === locationId);
  const [additionalPhotosError, setAdditionalPhotosError] = useState(false);
  // File inputs can't be programmatically restored after a submission (browsers clear
  // them for security), so this just lets the owner see what they'd picked before an
  // error, rather than silently losing that context along with the actual files.
  const [mainPhotoName, setMainPhotoName] = useState<string | null>(initialDraft?.mainPhotoName ?? null);
  const [additionalPhotoNames, setAdditionalPhotoNames] = useState<string[]>(
    initialDraft?.additionalPhotoNames ?? [],
  );

  // The map pin can be moved two ways: the owner types a new location (forward-geocoded
  // below) or drops a pin directly (reverse-geocoded back into the text field). Either one
  // re-mounts LocationPicker at the resolved point via `mapKey`, matching how it already
  // treats `initialLatitude`/`initialLongitude` as a fresh manual pin on mount.
  const [pinOverride, setPinOverride] = useState<{ lat: number; lng: number } | null>(
    initialDraft?.pinOverride ?? null,
  );
  const [mapKey, setMapKey] = useState(0);
  // Guards against an earlier geocode call resolving after a later, newer one.
  const geocodeRequestRef = useRef(0);

  // Keeps the draft in sync with what's on screen, so a crash mid-fill-in can be recovered above.
  useEffect(() => {
    writeSessionDraft<VesselFormDraft>(draftKey, {
      fields,
      locationId,
      pinOverride,
      mainPhotoName,
      additionalPhotoNames,
    });
  }, [draftKey, fields, locationId, pinOverride, mainPhotoName, additionalPhotoNames]);

  // Clears the draft once a submission actually settles successfully: `updateVessel` returns `{}`
  // directly, and `createVessel`'s redirect also resolves `isPending` back to false without ever
  // setting `state.error`. `wasPendingRef` distinguishes that from the initial mount, which also
  // starts out with `isPending === false` and `state.error === undefined`.
  const wasPendingRef = useRef(false);
  useEffect(() => {
    if (wasPendingRef.current && !isPending && !state.error) {
      clearSessionDraft(draftKey);
    }
    wasPendingRef.current = isPending;
  }, [isPending, state.error, draftKey]);

  function handleSelectLocation(value: string) {
    const next = value === NO_LOCATION ? undefined : value;
    setLocationId(next);
    setPinOverride(null);
    setMapKey((key) => key + 1);
    const location = locations.find((candidate) => candidate.id === next);
    setField("newLocationName", location ? locationLabel(location, locale) : "");
  }

  async function handleNewLocationBlur() {
    const value = fields.newLocationName.trim();
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
      if (label && requestId === geocodeRequestRef.current) {
        setField("newLocationName", label);
      }
    } catch {
      // Best-effort convenience — latitude/longitude are already captured either way.
    }
  }

  /** Translated message for a field's error code, or undefined if the field is clean. */
  function fieldError(name: string): string | undefined {
    const code = state.fieldErrors?.[name];
    return code ? t(`errors.${code}`) : undefined;
  }
  const locationError = fieldError("newLocationName") ?? fieldError("locationId");

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-soft md:p-8">
      <form action={formAction} className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="name">{t("name")}</Label>
          <Input
            id="name"
            name="name"
            value={fields.name}
            onChange={(event) => setField("name", event.target.value)}
            aria-invalid={Boolean(fieldError("name"))}
            required
          />
          {fieldError("name") && <p className="text-sm text-destructive">{fieldError("name")}</p>}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="slug">{t("slug")}</Label>
          <Input
            id="slug"
            name="slug"
            value={fields.slug}
            onChange={(event) => setField("slug", event.target.value)}
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            aria-invalid={Boolean(fieldError("slug"))}
            required
          />
          {fieldError("slug") && <p className="text-sm text-destructive">{fieldError("slug")}</p>}
        </div>

        <div className="flex flex-col gap-2">
          <Label>{t("type")}</Label>
          <Select value={fields.type} onValueChange={(value) => setField("type", value)}>
            <SelectTrigger className="w-full" aria-invalid={Boolean(fieldError("type"))}>
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
          <input type="hidden" name="type" value={fields.type} />
          {fieldError("type") && <p className="text-sm text-destructive">{fieldError("type")}</p>}
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
            name="newLocationName"
            value={fields.newLocationName}
            placeholder={t("newLocationPlaceholder")}
            onChange={(event) => {
              setField("newLocationName", event.target.value);
              setLocationId(undefined);
            }}
            onBlur={handleNewLocationBlur}
            aria-invalid={Boolean(locationError)}
          />
          <p className="text-xs font-light text-muted-foreground">{t("newLocationHint")}</p>
          {locationError && <p className="text-sm text-destructive">{locationError}</p>}
        </div>

        {mode === "create" && (
          <div className="flex flex-col gap-2 sm:col-span-2">
            <Label htmlFor="mainPhoto">{t("mainPhoto")}</Label>
            <Input
              id="mainPhoto"
              name="mainPhoto"
              type="file"
              accept={vesselImageAllowedTypes.join(",")}
              onChange={(event) => setMainPhotoName(event.target.files?.[0]?.name ?? null)}
              aria-invalid={Boolean(fieldError("mainPhoto"))}
              required
            />
            {mainPhotoName && (
              <p className="text-xs font-light text-muted-foreground">{mainPhotoName}</p>
            )}
            {fieldError("mainPhoto") && (
              <p className="text-sm text-destructive">{fieldError("mainPhoto")}</p>
            )}
            <Label htmlFor="additionalPhotos" className="mt-2">
              {t("additionalPhotos")}
            </Label>
            <Input
              id="additionalPhotos"
              name="additionalPhotos"
              type="file"
              accept={vesselImageAllowedTypes.join(",")}
              multiple
              onChange={(event) => {
                const files = event.target.files;
                setAdditionalPhotosError((files?.length ?? 0) > vesselImageMaxCount - 1);
                setAdditionalPhotoNames(files ? Array.from(files).map((file) => file.name) : []);
              }}
              aria-invalid={Boolean(fieldError("additionalPhotos"))}
            />
            {additionalPhotoNames.length > 0 && (
              <p className="text-xs font-light text-muted-foreground">
                {additionalPhotoNames.join(", ")}
              </p>
            )}
            <p className="text-xs font-light text-muted-foreground">{t("photosHint")}</p>
            {additionalPhotosError && (
              <p className="text-sm text-destructive">{t("errors.maxImages")}</p>
            )}
            {fieldError("additionalPhotos") && (
              <p className="text-sm text-destructive">{fieldError("additionalPhotos")}</p>
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
            value={fields.descriptionRu}
            onChange={(event) => setField("descriptionRu", event.target.value)}
            rows={4}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="descriptionEn">{t("descriptionEn")}</Label>
          <Textarea
            id="descriptionEn"
            name="descriptionEn"
            value={fields.descriptionEn}
            onChange={(event) => setField("descriptionEn", event.target.value)}
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
            value={fields.lengthMeters}
            onChange={(event) => setField("lengthMeters", event.target.value)}
            aria-invalid={Boolean(fieldError("lengthMeters"))}
            required
          />
          {fieldError("lengthMeters") && (
            <p className="text-sm text-destructive">{fieldError("lengthMeters")}</p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="yearBuilt">{t("yearBuilt")}</Label>
          <Input
            id="yearBuilt"
            name="yearBuilt"
            type="number"
            min="1900"
            max="2100"
            value={fields.yearBuilt}
            onChange={(event) => setField("yearBuilt", event.target.value)}
            aria-invalid={Boolean(fieldError("yearBuilt"))}
          />
          {fieldError("yearBuilt") && (
            <p className="text-sm text-destructive">{fieldError("yearBuilt")}</p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="cabins">{t("cabins")}</Label>
          <Input
            id="cabins"
            name="cabins"
            type="number"
            min="0"
            value={fields.cabins}
            onChange={(event) => setField("cabins", event.target.value)}
            aria-invalid={Boolean(fieldError("cabins"))}
            required
          />
          {fieldError("cabins") && <p className="text-sm text-destructive">{fieldError("cabins")}</p>}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="guestsCapacity">{t("guestsCapacity")}</Label>
          <Input
            id="guestsCapacity"
            name="guestsCapacity"
            type="number"
            min="1"
            value={fields.guestsCapacity}
            onChange={(event) => setField("guestsCapacity", event.target.value)}
            aria-invalid={Boolean(fieldError("guestsCapacity"))}
            required
          />
          {fieldError("guestsCapacity") && (
            <p className="text-sm text-destructive">{fieldError("guestsCapacity")}</p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="basePrice">{t("basePrice")}</Label>
          <Input
            id="basePrice"
            name="basePrice"
            type="number"
            step="0.01"
            min="0"
            value={fields.basePrice}
            onChange={(event) => setField("basePrice", event.target.value)}
            aria-invalid={Boolean(fieldError("basePrice"))}
            required
          />
          {fieldError("basePrice") && (
            <p className="text-sm text-destructive">{fieldError("basePrice")}</p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="currency">{t("currency")}</Label>
          <Select value={fields.currency} onValueChange={(value) => setField("currency", value)}>
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
          <input type="hidden" name="currency" value={fields.currency} />
        </div>

        <div className="flex flex-col gap-2">
          <Label>{t("status")}</Label>
          <Select value={fields.status} onValueChange={(value) => setField("status", value)}>
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
          <input type="hidden" name="status" value={fields.status} />
        </div>

        {state.error && (
          <p className="text-sm text-destructive sm:col-span-2">{t(`errors.${state.error}`)}</p>
        )}

        <div className="flex items-center gap-3 sm:col-span-2">
          <Button
            type="submit"
            size="lg"
            disabled={isPending || additionalPhotosError}
            className="rounded-full sm:w-fit"
          >
            {mode === "create" ? t("create") : t("save")}
          </Button>
          <Button asChild variant="outline" size="lg" className="rounded-full sm:w-fit">
            <Link href="/owner/vessels" onClick={() => clearSessionDraft(draftKey)}>
              {t("cancel")}
            </Link>
          </Button>
        </div>
      </form>
    </div>
  );
}
