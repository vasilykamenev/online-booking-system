"use client";

import { SlidersHorizontal } from "lucide-react";
import type { UseFormRegister } from "react-hook-form";
import { useTranslations } from "next-intl";
import type { SearchParamsInput } from "@/lib/validation/search";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

/**
 * Everything past the always-visible bar (`SearchFiltersForm`): price/length range and minimum
 * cabins. These fields belong to the same `react-hook-form` instance as the rest of the bar — this
 * component only groups them visually behind a "more filters" trigger (CLAUDE.md §5's "journal,
 * not a marketplace of tiles" — a permanently open 8-field sidebar would read as the latter). The
 * sheet itself has no submit of its own; values are already live in form state as the admin types,
 * and the bar's own "Apply" button is what actually pushes the URL.
 */
export function AdvancedFiltersSheet({
  register,
  activeCount,
}: {
  register: UseFormRegister<SearchParamsInput>;
  activeCount: number;
}) {
  const t = useTranslations("search.filters");

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button type="button" variant="outline" className="gap-2 rounded-full font-normal">
          <SlidersHorizontal className="size-4" strokeWidth={1.5} />
          {t("more")}
          {activeCount > 0 && (
            <Badge variant="secondary" className="rounded-full px-1.5 py-0 text-xs">
              {activeCount}
            </Badge>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-sm">
        <SheetHeader>
          <SheetTitle>{t("more")}</SheetTitle>
        </SheetHeader>
        <div className="flex flex-col gap-5 px-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="priceMin">{t("priceMin")}</Label>
              <Input
                id="priceMin"
                type="number"
                min={0}
                placeholder={t("priceMinPlaceholder")}
                {...register("priceMin")}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="priceMax">{t("priceMax")}</Label>
              <Input
                id="priceMax"
                type="number"
                min={0}
                placeholder={t("priceMaxPlaceholder")}
                {...register("priceMax")}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="lengthMin">{t("lengthMin")}</Label>
              <Input
                id="lengthMin"
                type="number"
                min={0}
                placeholder={t("lengthMinPlaceholder")}
                {...register("lengthMin")}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="lengthMax">{t("lengthMax")}</Label>
              <Input
                id="lengthMax"
                type="number"
                min={0}
                placeholder={t("lengthMaxPlaceholder")}
                {...register("lengthMax")}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="cabinsMin">{t("cabinsMin")}</Label>
            <Input
              id="cabinsMin"
              type="number"
              min={0}
              placeholder={t("cabinsMinPlaceholder")}
              {...register("cabinsMin")}
            />
          </div>
        </div>
        <SheetFooter>
          <SheetClose asChild>
            <Button type="button" className="rounded-full">
              {t("done")}
            </Button>
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
