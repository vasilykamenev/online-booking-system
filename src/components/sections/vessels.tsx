"use client";

import Image from "next/image";
import { motion } from "motion/react";
import { ArrowRight, MapPin, Star, Users2, DoorClosed } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/routing";
import type { FeaturedVessel } from "@/server/queries/vessels";
import { pickLocalized } from "@/lib/supabase/localized";
import { formatPrice } from "@/lib/pricing/format";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export function Vessels({ vessels }: { vessels: FeaturedVessel[] }) {
  const t = useTranslations("vessels");
  const locale = useLocale() as Locale;

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
            <motion.article
              key={vessel.id}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.5, delay: index * 0.08 }}
              whileHover={{ y: -6 }}
              className="group overflow-hidden rounded-2xl border border-border bg-card shadow-soft transition-[box-shadow,border-color] duration-300 hover:border-primary/25 hover:shadow-glow"
              style={{ transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)" }}
            >
              <div className="relative h-52 overflow-hidden bg-muted">
                {vessel.image && (
                  <Image
                    src={vessel.image.url}
                    alt={pickLocalized(vessel.image.alt, locale)}
                    fill
                    sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"
                    className="object-cover transition-transform duration-500 ease-out group-hover:scale-110"
                  />
                )}
                <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/35 to-transparent" />
                <Badge
                  variant="secondary"
                  className="absolute left-3 top-3 rounded-md bg-card/90 backdrop-blur-sm font-normal"
                >
                  {t(`types.${vessel.type}`)}
                </Badge>
                <div className="absolute right-3 top-3 flex items-center gap-1 rounded-md bg-card/95 px-2 py-1 backdrop-blur-sm">
                  <Star className="size-3 fill-primary text-primary" />
                  <span className="text-xs font-medium">{vessel.ratingAvg.toFixed(1)}</span>
                </div>
              </div>

              <div className="p-5">
                <h3 className="text-base font-medium tracking-tight text-card-foreground">
                  {vessel.name}
                </h3>
                <div className="mt-1 flex items-center gap-1 text-xs font-light text-muted-foreground">
                  <MapPin className="size-3" strokeWidth={1.5} />
                  <span>
                    {pickLocalized(vessel.country, locale)}, {pickLocalized(vessel.city, locale)}
                  </span>
                </div>

                <div className="mt-4 flex items-center gap-3 text-xs font-light text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Users2 className="size-3.5" strokeWidth={1.5} />
                    {vessel.guestsCapacity} {t("guests")}
                  </span>
                  <span className="flex items-center gap-1">
                    <DoorClosed className="size-3.5" strokeWidth={1.5} />
                    {vessel.cabins} {t("cabins")}
                  </span>
                </div>

                <div className="mt-5 flex items-center justify-between border-t border-border pt-4">
                  <div>
                    <span className="text-lg font-light text-foreground">
                      {formatPrice(vessel.basePriceMinor, vessel.currency, locale)}
                    </span>
                    <span className="text-xs font-light text-muted-foreground">
                      {" "}
                      {t("perNight")}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1 text-xs text-primary hover:text-primary"
                  >
                    {t("viewDetails")}
                    <ArrowRight className="size-3.5" />
                  </Button>
                </div>
              </div>
            </motion.article>
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="mt-12 flex justify-center"
        >
          <Button variant="outline" size="lg" className="gap-2 rounded-full">
            {t("viewAll")}
            <ArrowRight className="size-4" />
          </Button>
        </motion.div>
      </div>
    </section>
  );
}
