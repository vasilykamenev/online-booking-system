import { setRequestLocale } from "next-intl/server";
import { Hero } from "@/components/sections/hero";
import { Stats } from "@/components/sections/stats";
import { Vessels } from "@/components/sections/vessels";
import { Features } from "@/components/sections/features";
import { Initiatives } from "@/components/sections/initiatives";
import { CtaBanner } from "@/components/sections/cta-banner";
import { getFeaturedVessels } from "@/server/queries/vessels";
import { getCurrentProfile } from "@/server/queries/profile";
import { getFavoriteVesselIds } from "@/server/queries/account";

export default async function Home({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const [vessels, profile] = await Promise.all([getFeaturedVessels(), getCurrentProfile()]);
  const favoritedVesselIds = profile ? await getFavoriteVesselIds(profile.id) : new Set<string>();

  return (
    <>
      <Hero />
      <Stats />
      <Vessels vessels={vessels} favoritedVesselIds={favoritedVesselIds} />
      <Features />
      <Initiatives />
      <CtaBanner />
    </>
  );
}
