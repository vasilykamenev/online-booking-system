"use client";

import { useActionState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/routing";
import { createVessel, updateVessel, type VesselActionState } from "@/server/actions/vessels";
import { vesselTypeValues } from "@/lib/validation/search";
import { vesselStatusValues } from "@/lib/validation/vessel";
import type { SearchLocation, LocalizedText } from "@/server/queries/vessels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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

const initialState: VesselActionState = {};

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
    description: string;
    lengthMeters: number;
    cabins: number;
    guestsCapacity: number;
    yearBuilt: number | null;
    basePrice: number;
    currency: string;
    status: string;
  };
}) {
  const t = useTranslations("owner.vessels.form");
  const tTypes = useTranslations("vessels.types");
  const tStatus = useTranslations("owner.vessels.status");
  const locale = useLocale() as Locale;

  const action = mode === "create" ? createVessel.bind(null, locale) : updateVessel.bind(null, locale, vesselId!);
  const [state, formAction, isPending] = useActionState(action, initialState);

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
          <Select name="locationId" defaultValue={defaultValues?.locationId}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder={t("location")} />
            </SelectTrigger>
            <SelectContent>
              {locations.map((location) => (
                <SelectItem key={location.id} value={location.id}>
                  {locationLabel(location, locale)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-2 sm:col-span-2">
          <Label htmlFor="description">{t("description")}</Label>
          <Textarea
            id="description"
            name="description"
            defaultValue={defaultValues?.description}
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
          <Input
            id="currency"
            name="currency"
            maxLength={3}
            className="uppercase"
            defaultValue={defaultValues?.currency ?? "USD"}
            required
          />
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
          disabled={isPending}
          className="rounded-full sm:col-span-2 sm:w-fit"
        >
          {mode === "create" ? t("create") : t("save")}
        </Button>
      </form>
    </div>
  );
}
