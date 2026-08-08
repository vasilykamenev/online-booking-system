import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { requireProfile } from "@/server/queries/profile";
import { getFavoriteVessels } from "@/server/queries/account";
import { VesselCard } from "@/components/vessels/vessel-card";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "account.favorites" });
  return { title: `${t("title")} — Meridian` };
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
  const vessels = await getFavoriteVessels(profile.id);

  return (
    <div>
      <h1 className="text-xl font-medium tracking-tight">{t("title")}</h1>
      <p className="mt-1 text-sm font-light text-muted-foreground">{t("subtitle")}</p>

      {vessels.length === 0 ? (
        <p className="mt-10 rounded-2xl border border-dashed border-border p-10 text-center text-sm font-light text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2">
          {vessels.map((vessel, index) => (
            <VesselCard key={vessel.id} vessel={vessel} index={index} isFavorited />
          ))}
        </div>
      )}
    </div>
  );
}
