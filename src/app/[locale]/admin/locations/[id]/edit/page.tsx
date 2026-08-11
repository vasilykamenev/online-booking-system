import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { getLocationById } from "@/server/queries/admin";
import { LocationForm } from "../../location-form";
import { buildTitle } from "@/lib/site";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "admin.locations.form" });
  return { title: buildTitle(t("editTitle")) };
}

export default async function EditLocationPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = (await params) as { locale: Locale; id: string };
  setRequestLocale(locale);
  const t = await getTranslations("admin.locations.form");

  const location = await getLocationById(id);
  if (!location) notFound();

  return (
    <div>
      <h1 className="text-xl font-medium tracking-tight">{t("editTitle")}</h1>
      <p className="mt-1 text-sm font-light text-muted-foreground">{t("editSubtitle")}</p>
      <div className="mt-6">
        <LocationForm
          mode="edit"
          locationId={location.id}
          defaultValues={{
            countryRu: location.country.ru ?? "",
            countryEn: location.country.en ?? "",
            cityRu: location.city.ru ?? "",
            cityEn: location.city.en ?? "",
            marinaRu: location.marina?.ru ?? "",
            marinaEn: location.marina?.en ?? "",
            latitude: location.latitude,
            longitude: location.longitude,
          }}
        />
      </div>
    </div>
  );
}
