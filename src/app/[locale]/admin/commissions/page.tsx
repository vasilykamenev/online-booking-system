import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { getPlatformCommissionRate } from "@/server/queries/admin";
import { CommissionForm } from "./commission-form";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "admin.commissions" });
  return { title: `${t("title")} — Meridian` };
}

export default async function AdminCommissionsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  const t = await getTranslations("admin.commissions");

  const rate = await getPlatformCommissionRate();

  return (
    <div>
      <h1 className="text-xl font-medium tracking-tight">{t("title")}</h1>
      <p className="mt-1 text-sm font-light text-muted-foreground">{t("subtitle")}</p>

      <div className="mt-6 max-w-md rounded-2xl border border-border bg-card p-6 shadow-soft">
        <CommissionForm currentRatePercent={Math.round(rate * 1000) / 10} />
      </div>
    </div>
  );
}
