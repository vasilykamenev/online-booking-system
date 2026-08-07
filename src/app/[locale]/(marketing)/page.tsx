import { setRequestLocale } from "next-intl/server";
import { Hero } from "@/components/sections/hero";
import { Stats } from "@/components/sections/stats";
import { Vessels } from "@/components/sections/vessels";
import { Features } from "@/components/sections/features";
import { Initiatives } from "@/components/sections/initiatives";
import { CtaBanner } from "@/components/sections/cta-banner";
import { getFeaturedVessels } from "@/server/queries/vessels";

export default async function Home({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const vessels = await getFeaturedVessels();

  return (
    <>
      <Hero />
      <Stats />
      <Vessels vessels={vessels} />
      <Features />
      <Initiatives />
      <CtaBanner />
    </>
  );
}
