import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { getVesselBySlug } from "@/server/queries/vessels";
import { getCurrentProfile } from "@/server/queries/profile";
import { isVesselFavorited } from "@/server/queries/account";
import { getVesselBookingContext } from "@/server/queries/availability";
import { VesselDetailContent } from "./vessel-detail-content";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const vessel = await getVesselBySlug(slug);

  if (!vessel) return {};

  return {
    title: `${vessel.name} — Meridian`,
    description: vessel.description,
  };
}

export default async function VesselPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const vessel = await getVesselBySlug(slug);
  if (!vessel) notFound();

  const profile = await getCurrentProfile();
  const isFavorited = profile ? await isVesselFavorited(profile.id, vessel.id) : false;
  const bookingContext = await getVesselBookingContext(vessel.id);

  return (
    <VesselDetailContent
      vessel={vessel}
      isFavorited={isFavorited}
      pricingRules={bookingContext.pricingRules}
      unavailableRanges={bookingContext.unavailableRanges}
    />
  );
}
