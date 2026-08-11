import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { requireProfile } from "@/server/queries/profile";
import { getFavoriteVessels, getFavoriteInitiatives } from "@/server/queries/account";
import { VesselCard } from "@/components/vessels/vessel-card";
import { InitiativeCard } from "@/components/initiatives/initiative-card";
import { buildTitle } from "@/lib/site";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "account.favorites" });
  return { title: buildTitle(t("title")) };
}

export default async function AccountFavoritesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  const t = await getTranslations("account.favorites");

  const profile = await requireProfile(locale);
  const [vessels, initiatives] = await Promise.all([
    getFavoriteVessels(profile.id),
    getFavoriteInitiatives(profile.id),
  ]);

  return (
    <div>
      <h1 className="text-xl font-medium tracking-tight">{t("title")}</h1>
      <p className="mt-1 text-sm font-light text-muted-foreground">{t("subtitle")}</p>

      <div className="mt-8">
        <span className="uppercase-label mb-4 block">{t("vesselsEyebrow")}</span>
        {vessels.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border p-10 text-center text-sm font-light text-muted-foreground">
            {t("empty")}
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            {vessels.map((vessel, index) => (
              <VesselCard key={vessel.id} vessel={vessel} index={index} isFavorited />
            ))}
          </div>
        )}
      </div>

      <div className="mt-10">
        <span className="uppercase-label mb-4 block">{t("initiativesEyebrow")}</span>
        {initiatives.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border p-10 text-center text-sm font-light text-muted-foreground">
            {t("emptyInitiatives")}
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            {initiatives.map((initiative, index) => (
              <InitiativeCard
                key={initiative.id}
                initiative={initiative}
                index={index}
                isFavorited
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
