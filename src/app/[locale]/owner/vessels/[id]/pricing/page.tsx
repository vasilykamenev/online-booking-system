import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { requireProfile } from "@/server/queries/profile";
import { getOwnerVesselDetail, getVesselPricingRules } from "@/server/queries/owner";
import { formatPrice } from "@/lib/pricing/format";
import { PricingRulesManager } from "./pricing-rules-manager";
import { buildTitle } from "@/lib/site";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "owner.vessels.pricing" });
  return { title: buildTitle(t("title")) };
}

export default async function VesselPricingPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = (await params) as { locale: Locale; id: string };
  setRequestLocale(locale);
  const t = await getTranslations("owner.vessels.pricing");

  const profile = await requireProfile(locale);
  const vessel = await getOwnerVesselDetail(profile.id, id);
  if (!vessel) notFound();

  const rules = await getVesselPricingRules(id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-medium tracking-tight">{vessel.name}</h1>
        <p className="mt-1 text-sm font-light text-muted-foreground">
          {t("subtitle", { basePrice: formatPrice(vessel.basePriceMinor, vessel.currency, locale) })}
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-6 shadow-soft md:p-8">
        <PricingRulesManager vesselId={id} currency={vessel.currency} rules={rules} />
      </div>
    </div>
  );
}
