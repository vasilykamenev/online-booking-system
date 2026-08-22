"use client";

import Image from "next/image";
import { motion } from "motion/react";
import { ExternalLink, MapPin, Star, Users2, DoorClosed, Ship } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/routing";
import { Link } from "@/i18n/navigation";
import type { VesselSearchResult } from "@/lib/search/result";
import { formatPrice } from "@/lib/pricing/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/**
 * One unified result. Internal and external offers share this card by design (spec §6/§13) — the
 * user is comparing vessels, not data sources — but they never look identical: every external
 * result carries a visible, clickable attribution to the page it came from, which spec §14 makes
 * mandatory ("Нельзя возвращать AI-generated результат без ссылки на страницу").
 */
export function GlobalResultCard({ result, index = 0 }: { result: VesselSearchResult; index?: number }) {
  const t = useTranslations("discover");
  const tTypes = useTranslations("vessels.types");
  const locale = useLocale() as Locale;

  const image = result.images[0];
  const isInternal = result.origin === "INTERNAL";
  const place = [result.location.city, result.location.country].filter(Boolean).join(", ");

  return (
    <motion.article
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.45, delay: Math.min(index, 6) * 0.06 }}
      className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-soft transition-[box-shadow,border-color] duration-300 hover:border-primary/25 hover:shadow-hover"
    >
      <div className="relative h-48 overflow-hidden bg-muted">
        {image ? (
          <Image
            src={image.url}
            alt={image.alt ?? result.name ?? ""}
            fill
            sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
            className="object-cover transition-transform duration-500 ease-out group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <Ship className="size-8" strokeWidth={1.5} />
          </div>
        )}

        {(result.vesselType || result.vesselTypeRaw) && (
          <Badge
            variant="secondary"
            className="absolute left-3 top-3 rounded-md bg-card/90 font-normal backdrop-blur-sm"
          >
            {result.vesselType ? tTypes(result.vesselType) : result.vesselTypeRaw}
          </Badge>
        )}

        <Badge
          variant={isInternal ? "default" : "outline"}
          className="absolute right-3 top-3 rounded-md bg-card/95 font-normal text-card-foreground backdrop-blur-sm"
        >
          {isInternal ? t("origin.internal") : t("origin.external")}
        </Badge>
      </div>

      <div className="flex flex-1 flex-col p-5">
        <h3 className="text-base font-medium tracking-tight text-card-foreground">
          {result.name ?? t("untitled")}
        </h3>

        {place && (
          <p className="mt-1 flex items-center gap-1 text-xs font-light text-muted-foreground">
            <MapPin className="size-3" strokeWidth={1.5} />
            {place}
          </p>
        )}

        <div className="mt-3 flex flex-wrap gap-2 text-xs font-light text-muted-foreground">
          {result.capacity.guests !== null && (
            <span className="flex items-center gap-1 rounded-md bg-muted px-2 py-1">
              <Users2 className="size-3" strokeWidth={1.5} />
              {result.capacity.guests}
            </span>
          )}
          {result.capacity.cabins !== null && (
            <span className="flex items-center gap-1 rounded-md bg-muted px-2 py-1">
              <DoorClosed className="size-3" strokeWidth={1.5} />
              {result.capacity.cabins}
            </span>
          )}
          {result.lengthMeters !== null && (
            <span className="rounded-md bg-muted px-2 py-1">{t("lengthMeters", { value: result.lengthMeters })}</span>
          )}
          {result.ratingAvg !== null && result.ratingCount ? (
            <span className="flex items-center gap-1 rounded-md bg-muted px-2 py-1">
              <Star className="size-3 fill-primary text-primary" strokeWidth={1.5} />
              {result.ratingAvg.toFixed(1)}
            </span>
          ) : null}
        </div>

        <div className="mt-4 flex flex-1 items-end justify-between gap-3">
          <div>
            {result.rental.priceMinor !== null && result.rental.currency ? (
              <p className="text-lg font-light tracking-tight">
                {formatPrice(result.rental.priceMinor, result.rental.currency, locale)}
                <span className="ml-1 text-xs font-light text-muted-foreground">
                  {t(`priceUnit.${result.rental.priceUnit ?? "TRIP"}`)}
                </span>
              </p>
            ) : (
              <p className="text-sm font-light text-muted-foreground">{t("priceUnknown")}</p>
            )}
          </div>

          {isInternal && result.slug ? (
            <Button asChild size="sm" className="rounded-full">
              <Link href={`/vessels/${result.slug}`}>{t("open")}</Link>
            </Button>
          ) : (
            <Button asChild size="sm" variant="outline" className="rounded-full">
              {/* `nofollow`/`noopener` because this URL was discovered by crawling a third party — it
                  is untrusted output, and we neither vouch for it nor pass ranking signal to it. */}
              <a href={result.source.url} target="_blank" rel="noopener noreferrer nofollow">
                {t("openSource")}
                <ExternalLink className="size-3.5" strokeWidth={1.5} />
              </a>
            </Button>
          )}
        </div>

        {/* Provenance is never optional for external data (spec §14), and a vessel that was folded
            from several listings (spec §17) must stay traceable to every one of them regardless of
            which listing became the primary card — an internal-origin result can carry
            `alternateSources` too, once it absorbed a matching external offer. */}
        {(!isInternal || result.alternateSources.length > 0) && (
          <div className="mt-3 space-y-1 border-t border-border pt-3 text-[11px] font-light text-muted-foreground">
            {!isInternal && <p>{t("sourceLabel", { name: result.source.name })}</p>}
            {result.alternateSources.length > 0 && (
              <p>
                {t("alsoListedOn", { count: result.alternateSources.length })}{" "}
                {result.alternateSources.map((source, sourceIndex) => (
                  <span key={source.url}>
                    {sourceIndex > 0 && ", "}
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="underline decoration-dotted underline-offset-2 hover:text-foreground"
                    >
                      {source.name}
                    </a>
                  </span>
                ))}
              </p>
            )}
          </div>
        )}
      </div>
    </motion.article>
  );
}
