"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { buildSearchUrl, vesselSortValues, type SearchParams, type VesselSort } from "@/lib/validation/search";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Sort lives outside `SearchFiltersForm`'s form — it's a view of the same result set, not a
 *  criterion, so changing it goes straight to the URL (via the shared `buildSearchUrl`) instead of
 *  round-tripping through react-hook-form. */
export function SortSelect({ filters }: { filters: SearchParams }) {
  const t = useTranslations("search.sort");
  const router = useRouter();

  return (
    <Select
      value={filters.sort ?? "rating_desc"}
      onValueChange={(value) => router.push(buildSearchUrl({ ...filters, sort: value as VesselSort }))}
    >
      <SelectTrigger className="w-fit gap-2 rounded-full" size="sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {vesselSortValues.map((value) => (
          <SelectItem key={value} value={value}>
            {t(value)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
