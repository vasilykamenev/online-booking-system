"use client";

import { motion } from "motion/react";
import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";
import type { FeaturedVessel } from "@/server/queries/vessels";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { VesselCard } from "@/components/vessels/vessel-card";

export function Vessels({
  vessels,
  favoritedVesselIds = new Set(),
}: {
  vessels: FeaturedVessel[];
  favoritedVesselIds?: Set<string>;
}) {
  const t = useTranslations("vessels");

  return (
    <section id="vessels" className="bg-background py-24 lg:py-32">
      <div className="container-page">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.6 }}
          className="mx-auto mb-16 max-w-2xl text-center"
        >
          <span className="uppercase-label mb-4 block">{t("eyebrow")}</span>
          <h2 className="text-3xl font-light tracking-tight text-balance md:text-4xl lg:text-5xl">
            {t("title")}
          </h2>
          <p className="mt-4 text-sm font-light leading-relaxed text-muted-foreground md:text-base">
            {t("subtitle")}
          </p>
        </motion.div>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {vessels.map((vessel, index) => (
            <VesselCard
              key={vessel.id}
              vessel={vessel}
              index={index}
              isFavorited={favoritedVesselIds.has(vessel.id)}
            />
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="mt-12 flex justify-center"
        >
          <Button asChild variant="outline" size="lg" className="gap-2 rounded-full">
            <Link href="/search">
              {t("viewAll")}
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </motion.div>
      </div>
    </section>
  );
}
