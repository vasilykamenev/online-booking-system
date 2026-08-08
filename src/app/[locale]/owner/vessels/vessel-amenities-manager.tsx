"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/routing";
import { useRouter } from "@/i18n/navigation";
import { setVesselAmenities } from "@/server/actions/vessels";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import type { Amenity } from "@/server/queries/vessels";

export function VesselAmenitiesManager({
  vesselId,
  amenities,
  selectedIds,
}: {
  vesselId: string;
  amenities: Amenity[];
  selectedIds: string[];
}) {
  const t = useTranslations("owner.vessels.form");
  const tAmenities = useTranslations("vessels.amenities");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    const ids = formData.getAll("amenityIds") as string[];
    startTransition(async () => {
      const result = await setVesselAmenities(locale, vesselId, ids);
      if (result.error) {
        toast.error(t("errors.generic"));
        return;
      }
      toast.success(t("amenitiesSaved"));
      router.refresh();
    });
  }

  return (
    <form action={handleSubmit} className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {amenities.map((amenity) => (
        <div key={amenity.id} className="flex items-center gap-2">
          <Checkbox
            id={`amenity-${amenity.id}`}
            name="amenityIds"
            value={amenity.id}
            defaultChecked={selectedIds.includes(amenity.id)}
          />
          <Label htmlFor={`amenity-${amenity.id}`} className="text-sm font-normal">
            {tAmenities(amenity.key)}
          </Label>
        </div>
      ))}
      <Button
        type="submit"
        variant="outline"
        size="sm"
        disabled={isPending}
        className="col-span-full mt-2 w-fit rounded-full"
      >
        {t("saveAmenities")}
      </Button>
    </form>
  );
}
