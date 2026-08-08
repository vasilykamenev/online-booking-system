import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { getSearchLocations } from "@/server/queries/vessels";
import { VesselForm } from "../vessel-form";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "owner.vessels.form" });
  return { title: `${t("create")} — Meridian` };
}

export default async function NewVesselPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  const t = await getTranslations("owner.vessels.form");
  const locations = await getSearchLocations();

  return (
    <div>
      <h1 className="text-xl font-medium tracking-tight">{t("createTitle")}</h1>
      <p className="mt-1 text-sm font-light text-muted-foreground">{t("createSubtitle")}</p>
      <div className="mt-6">
        <VesselForm mode="create" locations={locations} />
      </div>
    </div>
  );
}
