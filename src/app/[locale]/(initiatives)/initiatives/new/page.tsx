import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { requireProfile } from "@/server/queries/profile";
import { InitiativeForm } from "./initiative-form";
import { buildTitle } from "@/lib/site";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "initiativesPage.form" });
  return { title: buildTitle(t("createTitle")) };
}

export default async function NewInitiativePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  await requireProfile(locale);
  const t = await getTranslations("initiativesPage.form");

  return (
    <div className="container-page pt-24 pb-24 lg:pt-28">
      <div className="mx-auto max-w-2xl">
        <h1 className="text-2xl font-medium tracking-tight">{t("createTitle")}</h1>
        <p className="mt-1 text-sm font-light text-muted-foreground">{t("createSubtitle")}</p>
        <div className="mt-6">
          <InitiativeForm />
        </div>
      </div>
    </div>
  );
}
