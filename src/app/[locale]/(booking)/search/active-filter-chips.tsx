"use client";

import { X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/routing";
import { useRouter } from "@/i18n/navigation";
import {
  activeFilterChipKeys,
  removeSearchFilterUrl,
  type FilterChipKey,
  type SearchParams,
} from "@/lib/validation/search";
import { pickLocalized } from "@/lib/supabase/localized";
import type { SearchLocation } from "@/server/queries/vessels";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

/** Human-readable label for one active chip — the only part of this file that isn't pure, since it
 *  needs both i18n and the resolved location name; the *set* of active chips itself comes from the
 *  pure `activeFilterChipKeys` (`lib/validation/search.ts`), unit-tested on its own. */
function chipLabel(
  key: FilterChipKey,
  filters: SearchParams,
  locations: SearchLocation[],
  locale: Locale,
  t: ReturnType<typeof useTranslations>,
  tVessels: ReturnType<typeof useTranslations>,
): string {
  switch (key) {
    case "type":
      return filters.type ? tVessels(`types.${filters.type}`) : "";
    case "location": {
      const location = locations.find((candidate) => candidate.id === filters.location);
      return location
        ? `${pickLocalized(location.country, locale)}, ${pickLocalized(location.city, locale)}`
        : t("location");
    }
    case "guests":
      return t("chips.guests", { count: filters.guests ?? 0 });
    case "priceMin":
      return t("chips.priceMin", { value: filters.priceMin ?? 0 });
    case "priceMax":
      return t("chips.priceMax", { value: filters.priceMax ?? 0 });
    case "lengthMin":
      return t("chips.lengthMin", { value: filters.lengthMin ?? 0 });
    case "lengthMax":
      return t("chips.lengthMax", { value: filters.lengthMax ?? 0 });
    case "cabinsMin":
      return t("chips.cabinsMin", { count: filters.cabinsMin ?? 0 });
    case "dates":
      return filters.dateFrom && filters.dateTo
        ? t("chips.dates", { from: filters.dateFrom, to: filters.dateTo })
        : "";
  }
}

export function ActiveFilterChips({
  filters,
  locations,
}: {
  filters: SearchParams;
  locations: SearchLocation[];
}) {
  const t = useTranslations("search.filters");
  const tVessels = useTranslations("vessels");
  const locale = useLocale() as Locale;
  const router = useRouter();

  const keys = activeFilterChipKeys(filters);
  if (keys.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {keys.map((key) => (
        <Badge key={key} variant="secondary" className="gap-1 rounded-full py-1.5 pr-1.5 pl-3 font-normal">
          {chipLabel(key, filters, locations, locale, t, tVessels)}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-5 rounded-full hover:bg-background/60"
            aria-label={t("chips.remove")}
            onClick={() => router.push(removeSearchFilterUrl(filters, key))}
          >
            <X className="size-3" strokeWidth={1.5} />
          </Button>
        </Badge>
      ))}
    </div>
  );
}
