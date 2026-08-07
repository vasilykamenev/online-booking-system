"use client";

import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/routing";
import { useRouter } from "@/i18n/navigation";
import {
  searchParamsSchema,
  vesselTypeValues,
  type SearchParams,
  type SearchParamsInput,
} from "@/lib/validation/search";
import { pickLocalized } from "@/lib/supabase/localized";
import type { SearchLocation } from "@/server/queries/vessels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ANY = "any";

export function SearchFiltersForm({
  locations,
  defaultValues,
}: {
  locations: SearchLocation[];
  defaultValues: SearchParamsInput;
}) {
  const t = useTranslations("search");
  const tVessels = useTranslations("vessels");
  const locale = useLocale() as Locale;
  const router = useRouter();

  const form = useForm<SearchParamsInput, unknown, SearchParams>({
    resolver: zodResolver(searchParamsSchema),
    defaultValues,
  });
  const locationValue = useWatch({ control: form.control, name: "location" });
  const typeValue = useWatch({ control: form.control, name: "type" });

  function onSubmit(values: SearchParams) {
    const params = new URLSearchParams();
    if (values.type) params.set("type", values.type);
    if (values.location) params.set("location", values.location);
    if (values.guests) params.set("guests", String(values.guests));
    if (values.priceMax) params.set("priceMax", String(values.priceMax));
    router.push(params.size > 0 ? `/search?${params.toString()}` : "/search");
  }

  return (
    <form
      onSubmit={form.handleSubmit(onSubmit)}
      className="grid grid-cols-1 gap-4 rounded-2xl border border-border bg-card p-5 shadow-soft sm:grid-cols-2 lg:grid-cols-5 lg:items-end"
    >
      <div className="space-y-2">
        <Label>{t("filters.location")}</Label>
        <Select
          value={locationValue ?? ANY}
          onValueChange={(value) =>
            form.setValue("location", value === ANY ? undefined : value)
          }
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder={t("filters.anyLocation")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>{t("filters.anyLocation")}</SelectItem>
            {locations.map((location) => (
              <SelectItem key={location.id} value={location.id}>
                {pickLocalized(location.country, locale)}, {pickLocalized(location.city, locale)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>{t("filters.type")}</Label>
        <Select
          value={typeValue ?? ANY}
          onValueChange={(value) =>
            form.setValue(
              "type",
              value === ANY ? undefined : (value as SearchParams["type"]),
            )
          }
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder={t("filters.anyType")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>{t("filters.anyType")}</SelectItem>
            {vesselTypeValues.map((type) => (
              <SelectItem key={type} value={type}>
                {tVessels(`types.${type}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="guests">{t("filters.guests")}</Label>
        <Input
          id="guests"
          type="number"
          min={1}
          placeholder={t("filters.guestsPlaceholder")}
          {...form.register("guests")}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="priceMax">{t("filters.priceMax")}</Label>
        <Input
          id="priceMax"
          type="number"
          min={1}
          placeholder={t("filters.priceMaxPlaceholder")}
          {...form.register("priceMax")}
        />
      </div>

      <Button type="submit" size="lg" className="rounded-full">
        {t("filters.apply")}
      </Button>
    </form>
  );
}
