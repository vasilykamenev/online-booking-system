"use client";

import type { ReactNode } from "react";
import Image from "next/image";
import { motion } from "motion/react";
import {
  ArrowLeft,
  Calendar,
  Check,
  DoorClosed,
  MapPin,
  Ruler,
  Star,
  Users2,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/routing";
import type { VesselDetail } from "@/server/queries/vessels";
import { pickLocalized } from "@/lib/supabase/localized";
import { Link } from "@/i18n/navigation";
import { Badge } from "@/components/ui/badge";
import { FavoriteButton } from "@/components/vessels/favorite-button";
import { BookingWidget } from "@/components/booking/booking-widget";
import { LocationMap } from "@/components/map/location-map";
import type { PricingRule } from "@/lib/pricing/calculate";
import type { DateInterval } from "@/lib/availability/ranges";

export function VesselDetailContent({
  vessel,
  isFavorited = false,
  pricingRules,
  unavailableRanges,
}: {
  vessel: VesselDetail;
  isFavorited?: boolean;
  pricingRules: PricingRule[];
  unavailableRanges: DateInterval[];
}) {
  const t = useTranslations("vesselPage");
  const tVessels = useTranslations("vessels");
  const locale = useLocale() as Locale;

  const mainImage = vessel.images[0];
  const thumbnails = vessel.images.slice(1);

  const locationText = [
    pickLocalized(vessel.country, locale),
    pickLocalized(vessel.city, locale),
    vessel.marina ? pickLocalized(vessel.marina, locale) : null,
  ]
    .filter(Boolean)
    .join(", ");
  const hasPin = vessel.latitude != null && vessel.longitude != null;

  return (
    <div className="pt-24 lg:pt-28">
      <div className="container-page pt-6">
        <Link
          href="/#vessels"
          className="inline-flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" strokeWidth={1.5} />
          {t("back")}
        </Link>
      </div>

      <section className="container-page mt-6">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="relative h-[42vh] min-h-[320px] overflow-hidden rounded-2xl bg-muted"
        >
          {mainImage && (
            <Image
              src={mainImage.url}
              alt={pickLocalized(mainImage.alt, locale)}
              fill
              priority
              sizes="(min-width: 1024px) 1200px, 100vw"
              className="object-cover"
            />
          )}
          <FavoriteButton
            vesselId={vessel.id}
            initialFavorited={isFavorited}
            className="absolute right-4 top-4 size-10"
            iconClassName="size-5"
          />
        </motion.div>

        {thumbnails.length > 0 && (
          <div className="mt-3 grid grid-cols-4 gap-3">
            {thumbnails.map((image) => (
              <div
                key={image.url}
                className="relative h-24 overflow-hidden rounded-xl bg-muted"
              >
                <Image
                  src={image.url}
                  alt={pickLocalized(image.alt, locale)}
                  fill
                  sizes="25vw"
                  className="object-cover"
                />
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="py-16 lg:py-20">
        <div className="container-page grid grid-cols-1 gap-12 lg:grid-cols-[1.6fr_1fr] lg:gap-16">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: 0.5 }}
          >
            <Badge variant="secondary" className="rounded-md font-normal">
              {tVessels(`types.${vessel.type}`)}
            </Badge>

            <h1 className="mt-4 text-3xl font-light tracking-tight text-balance md:text-4xl">
              {vessel.name}
            </h1>

            <div className="mt-3 flex flex-wrap items-center gap-4 text-sm font-light text-muted-foreground">
              {hasPin ? (
                <a
                  href="#location"
                  className="flex items-center gap-1.5 transition-colors hover:text-foreground"
                >
                  <MapPin className="size-4" strokeWidth={1.5} />
                  {locationText}
                </a>
              ) : (
                <span className="flex items-center gap-1.5">
                  <MapPin className="size-4" strokeWidth={1.5} />
                  {locationText}
                </span>
              )}
              <span className="flex items-center gap-1.5">
                <Star className="size-4 fill-primary text-primary" />
                <span className="font-medium text-foreground">
                  {vessel.ratingAvg.toFixed(1)}
                </span>
                <span>({t("reviews.count", { count: vessel.ratingCount })})</span>
              </span>
            </div>

            <div className="mt-8 border-t border-border pt-8">
              <h2 className="text-base font-medium tracking-tight">
                {t("descriptionTitle")}
              </h2>
              <p className="mt-3 text-sm font-light leading-relaxed text-muted-foreground">
                {vessel.description}
              </p>
            </div>

            <div className="mt-8 border-t border-border pt-8">
              <span className="uppercase-label mb-4 block">{t("specs.eyebrow")}</span>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <SpecItem
                  icon={<Ruler className="size-5" strokeWidth={1.5} />}
                  label={t("specs.length")}
                  value={`${vessel.lengthMeters} ${t("specs.lengthUnit")}`}
                />
                <SpecItem
                  icon={<DoorClosed className="size-5" strokeWidth={1.5} />}
                  label={t("specs.cabins")}
                  value={vessel.cabins}
                />
                <SpecItem
                  icon={<Users2 className="size-5" strokeWidth={1.5} />}
                  label={t("specs.guests")}
                  value={vessel.guestsCapacity}
                />
                {vessel.yearBuilt && (
                  <SpecItem
                    icon={<Calendar className="size-5" strokeWidth={1.5} />}
                    label={t("specs.yearBuilt")}
                    value={vessel.yearBuilt}
                  />
                )}
              </div>
            </div>

            {hasPin && (
              <div id="location" className="mt-8 scroll-mt-28 border-t border-border pt-8">
                <span className="uppercase-label mb-4 block">{t("locationEyebrow")}</span>
                <h2 className="text-base font-medium tracking-tight">{t("locationTitle")}</h2>
                <p className="mt-1 text-sm font-light text-muted-foreground">{locationText}</p>
                <div className="mt-4">
                  <LocationMap
                    latitude={vessel.latitude!}
                    longitude={vessel.longitude!}
                    label={locationText}
                  />
                </div>
              </div>
            )}

            {vessel.amenityKeys.length > 0 && (
              <div className="mt-8 border-t border-border pt-8">
                <h2 className="text-base font-medium tracking-tight">
                  {t("amenitiesTitle")}
                </h2>
                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {vessel.amenityKeys.map((key) => (
                    <span
                      key={key}
                      className="flex items-center gap-2 text-sm font-light text-muted-foreground"
                    >
                      <Check className="size-4 shrink-0 text-primary" strokeWidth={1.5} />
                      {tVessels(`amenities.${key}`)}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-8 border-t border-border pt-8">
              <span className="uppercase-label mb-4 block">{t("reviews.eyebrow")}</span>
              <h2 className="text-base font-medium tracking-tight">{t("reviews.title")}</h2>

              {vessel.reviews.length === 0 ? (
                <p className="mt-3 text-sm font-light text-muted-foreground">
                  {t("reviews.empty")}
                </p>
              ) : (
                <ul className="mt-4 space-y-5">
                  {vessel.reviews.map((review) => (
                    <li
                      key={review.id}
                      className="rounded-2xl border border-border bg-card p-5 shadow-soft"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1">
                          <Star className="size-3.5 fill-primary text-primary" />
                          <span className="text-sm font-medium">{review.rating}</span>
                        </div>
                        <span className="text-xs font-light text-muted-foreground">
                          {new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(
                            new Date(review.createdAt),
                          )}
                        </span>
                      </div>
                      {review.comment && (
                        <p className="mt-3 text-sm font-light leading-relaxed text-muted-foreground">
                          {review.comment}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="h-fit rounded-2xl border border-border bg-card p-6 shadow-soft lg:sticky lg:top-28"
          >
            <BookingWidget
              vesselId={vessel.id}
              basePriceMinor={vessel.basePriceMinor}
              currency={vessel.currency}
              guestsCapacity={vessel.guestsCapacity}
              pricingRules={pricingRules}
              unavailableRanges={unavailableRanges}
            />
          </motion.div>
        </div>
      </section>
    </div>
  );
}

function SpecItem({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
        {icon}
      </div>
      <div className="mt-3 text-lg font-light text-foreground">{value}</div>
      <div className="text-xs font-light text-muted-foreground">{label}</div>
    </div>
  );
}
