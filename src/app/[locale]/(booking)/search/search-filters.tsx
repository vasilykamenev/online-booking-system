"use client";

import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/routing";
import { useRouter } from "@/i18n/navigation";
import {
  activeFilterChipKeys,
  buildSearchUrl,
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
import { DateRangeField } from "./date-range-field";
import { AdvancedFiltersSheet } from "./advanced-filters-sheet";
import { ActiveFilterChips } from "./active-filter-chips";

const ANY = "any";
/** Chips that live in the "more filters" sheet — used only to badge its trigger with a count;
 *  location/type/guests/dates already have their own visible control in the bar. */
const ADVANCED_CHIP_KEYS = new Set(["priceMin", "priceMax", "lengthMin", "lengthMax", "cabinsMin"]);

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
  const dateFromValue = useWatch({ control: form.control, name: "dateFrom" });
  const dateToValue = useWatch({ control: form.control, name: "dateTo" });

  function onSubmit(values: SearchParams) {
    router.push(buildSearchUrl(values));
  }

  // Chips and the "more filters" badge deliberately read `defaultValues` (what's actually applied
  // to the results below, i.e. the URL this page was loaded with) rather than the form's live watch
  // state — otherwise removing one chip via its own router.push could silently apply an unrelated
  // field the admin had typed into the advanced sheet but never hit "Apply" for.
  const appliedFilters = defaultValues as SearchParams;
  const advancedActiveCount = activeFilterChipKeys(appliedFilters).filter((key) =>
    ADVANCED_CHIP_KEYS.has(key),
  ).length;

  return (
    <form
      onSubmit={form.handleSubmit(onSubmit)}
      className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-soft"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6 lg:items-end">
        <div className="flex flex-col gap-2 lg:col-span-2">
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

        <div className="flex flex-col gap-2">
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

        <div className="flex flex-col gap-2">
          <Label htmlFor="guests">{t("filters.guests")}</Label>
          <Input
            id="guests"
            type="number"
            min={1}
            placeholder={t("filters.guestsPlaceholder")}
            {...form.register("guests")}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label>{t("filters.dates")}</Label>
          <DateRangeField
            dateFrom={dateFromValue as string | undefined}
            dateTo={dateToValue as string | undefined}
            onChange={(dateFrom, dateTo) => {
              form.setValue("dateFrom", dateFrom);
              form.setValue("dateTo", dateTo);
            }}
          />
        </div>

        <div className="flex items-end gap-2">
          <AdvancedFiltersSheet register={form.register} activeCount={advancedActiveCount} />
          <Button type="submit" size="lg" className="flex-1 rounded-full">
            {t("filters.apply")}
          </Button>
        </div>
      </div>

      <ActiveFilterChips filters={appliedFilters} locations={locations} />
    </form>
  );
}
