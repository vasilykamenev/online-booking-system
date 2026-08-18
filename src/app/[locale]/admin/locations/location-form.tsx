"use client";

import { useActionState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/routing";
import { createLocation, updateLocation, type LocationActionState } from "@/server/actions/admin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: LocationActionState = {};

export function LocationForm({
  mode,
  locationId,
  defaultValues,
}: {
  mode: "create" | "edit";
  locationId?: string;
  defaultValues?: {
    countryRu: string;
    countryEn: string;
    cityRu: string;
    cityEn: string;
    marinaRu: string;
    marinaEn: string;
    latitude: number | null;
    longitude: number | null;
  };
}) {
  const t = useTranslations("admin.locations.form");
  const locale = useLocale() as Locale;

  const action =
    mode === "create" ? createLocation.bind(null, locale) : updateLocation.bind(null, locale, locationId!);
  const [state, formAction, isPending] = useActionState(action, initialState);

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-soft md:p-8">
      <form action={formAction} className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="countryRu">{t("countryRu")}</Label>
          <Input id="countryRu" name="countryRu" defaultValue={defaultValues?.countryRu} required />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="countryEn">{t("countryEn")}</Label>
          <Input id="countryEn" name="countryEn" defaultValue={defaultValues?.countryEn} required />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="cityRu">{t("cityRu")}</Label>
          <Input id="cityRu" name="cityRu" defaultValue={defaultValues?.cityRu} required />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="cityEn">{t("cityEn")}</Label>
          <Input id="cityEn" name="cityEn" defaultValue={defaultValues?.cityEn} required />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="marinaRu">{t("marinaRu")}</Label>
          <Input id="marinaRu" name="marinaRu" defaultValue={defaultValues?.marinaRu} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="marinaEn">{t("marinaEn")}</Label>
          <Input id="marinaEn" name="marinaEn" defaultValue={defaultValues?.marinaEn} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="latitude">{t("latitude")}</Label>
          <Input
            id="latitude"
            name="latitude"
            type="number"
            step="0.00001"
            min="-90"
            max="90"
            defaultValue={defaultValues?.latitude ?? undefined}
            required
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="longitude">{t("longitude")}</Label>
          <Input
            id="longitude"
            name="longitude"
            type="number"
            step="0.00001"
            min="-180"
            max="180"
            defaultValue={defaultValues?.longitude ?? undefined}
            required
          />
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
