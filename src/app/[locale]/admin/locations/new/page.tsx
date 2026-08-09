import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { LocationForm } from "../location-form";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "admin.locations.form" });
  return { title: `${t("createTitle")} — Meridian` };
}

export default async function NewLocationPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  const t = await getTranslations("admin.locations.form");

  return (
    <div>
      <h1 className="text-xl font-medium tracking-tight">{t("createTitle")}</h1>
      <p className="mt-1 text-sm font-light text-muted-foreground">{t("createSubtitle")}</p>
      <div className="mt-6">
        <LocationForm mode="create" />
      </div>
    </div>
  );
}
