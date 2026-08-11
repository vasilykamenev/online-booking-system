import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { requireProfile } from "@/server/queries/profile";
import { getOwnerVesselDetail } from "@/server/queries/owner";
import { getSearchLocations, getAllAmenities } from "@/server/queries/vessels";
import { VesselForm } from "../../vessel-form";
import { VesselImagesManager } from "../../vessel-images-manager";
import { VesselAmenitiesManager } from "../../vessel-amenities-manager";
import { buildTitle } from "@/lib/site";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "owner.vessels.form" });
  return { title: buildTitle(t("editTitle")) };
}

export default async function EditVesselPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = (await params) as { locale: Locale; id: string };
  setRequestLocale(locale);
  const t = await getTranslations("owner.vessels.form");

  const profile = await requireProfile(locale);
  const [vessel, locations, amenities] = await Promise.all([
    getOwnerVesselDetail(profile.id, id),
    getSearchLocations(),
    getAllAmenities(),
  ]);
  if (!vessel) notFound();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-medium tracking-tight">{vessel.name}</h1>
        <p className="mt-1 text-sm font-light text-muted-foreground">{t("editSubtitle")}</p>
      </div>

      <VesselForm
        mode="edit"
        vesselId={vessel.id}
        locations={locations}
        defaultValues={{
          name: vessel.name,
          slug: vessel.slug,
          type: vessel.type,
          locationId: vessel.locationId,
          description: vessel.description,
          lengthMeters: vessel.lengthMeters,
          cabins: vessel.cabins,
          guestsCapacity: vessel.guestsCapacity,
          yearBuilt: vessel.yearBuilt,
          basePrice: vessel.basePriceMinor / 100,
          currency: vessel.currency,
          status: vessel.status,
        }}
      />

      <div className="rounded-2xl border border-border bg-card p-6 shadow-soft md:p-8">
        <h2 className="text-base font-medium tracking-tight">{t("imagesTitle")}</h2>
        <div className="mt-4">
          <VesselImagesManager vesselId={vessel.id} images={vessel.images} />
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-6 shadow-soft md:p-8">
        <h2 className="text-base font-medium tracking-tight">{t("amenitiesTitle")}</h2>
        <div className="mt-4">
          <VesselAmenitiesManager
            vesselId={vessel.id}
            amenities={amenities}
            selectedIds={vessel.amenityIds}
          />
        </div>
      </div>
    </div>
  );
}
