import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { requireProfile } from "@/server/queries/profile";
import { getOwnerVesselDetail, getVesselAvailability, getVesselBookedRanges } from "@/server/queries/owner";
import { VesselCalendarView } from "./vessel-calendar-view";
import { AvailabilityManager } from "./availability-manager";
import { buildTitle } from "@/lib/site";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "owner.vessels.calendar" });
  return { title: buildTitle(t("title")) };
}

export default async function VesselCalendarPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = (await params) as { locale: Locale; id: string };
  setRequestLocale(locale);
  const t = await getTranslations("owner.vessels.calendar");

  const profile = await requireProfile(locale);
  const vessel = await getOwnerVesselDetail(profile.id, id);
  if (!vessel) notFound();

  const [blocks, bookedRanges] = await Promise.all([
    getVesselAvailability(id),
    getVesselBookedRanges(id),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-medium tracking-tight">{vessel.name}</h1>
        <p className="mt-1 text-sm font-light text-muted-foreground">{t("subtitle")}</p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-6 shadow-soft md:p-8">
        <VesselCalendarView
          bookedRanges={bookedRanges}
          blockedRanges={blocks.map((block) => block.dateRange)}
        />
      </div>

      <div className="rounded-2xl border border-border bg-card p-6 shadow-soft md:p-8">
        <h2 className="text-base font-medium tracking-tight">{t("blocksTitle")}</h2>
        <div className="mt-4">
          <AvailabilityManager vesselId={id} blocks={blocks} />
        </div>
      </div>
    </div>
  );
}
