"use client";

import { motion } from "motion/react";
import { ArrowUpRight, MapPin } from "lucide-react";
import { useTranslations } from "next-intl";
import type { InitiativeCard as InitiativeCardData } from "@/server/queries/initiatives";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { InitiativeFavoriteButton } from "@/components/initiatives/initiative-favorite-button";

export function InitiativeCard({
  initiative,
  index = 0,
  isFavorited = false,
}: {
  initiative: InitiativeCardData;
  index?: number;
  isFavorited?: boolean;
}) {
  const t = useTranslations("initiativesPage");

  return (
    <motion.article
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.5, delay: index * 0.08 }}
      whileHover={{ y: -6 }}
      className="group relative flex flex-col rounded-2xl border border-border bg-card p-6 shadow-soft transition-[box-shadow,border-color] duration-300 hover:border-primary/25 hover:shadow-glow"
      style={{ transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)" }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="secondary" className="font-normal">
            {initiative.topic}
          </Badge>
          <Badge variant={initiative.status === "open" ? "default" : "outline"}>
            {t(`status.${initiative.status}`)}
          </Badge>
        </div>
        <InitiativeFavoriteButton initiativeId={initiative.id} initialFavorited={isFavorited} />
      </div>

      <Link href={`/initiatives/${initiative.id}`} className="mt-4 block">
        <h3 className="text-base font-medium tracking-tight hover:text-primary">
          {initiative.title}
        </h3>
      </Link>
      <div className="mt-1 flex items-center gap-1 text-xs font-light text-muted-foreground">
        <MapPin className="size-3" strokeWidth={1.5} />
        {initiative.region}
      </div>
      <p className="mt-3 line-clamp-3 flex-1 text-sm font-light leading-relaxed text-muted-foreground">
        {initiative.description}
      </p>

      <div className="mt-5 flex items-center justify-between border-t border-border pt-4">
        <span className="truncate text-xs font-light text-muted-foreground">
          {initiative.authorName ?? t("card.unknownAuthor")}
        </span>
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="gap-1 px-0 text-xs text-primary hover:bg-transparent hover:text-primary/80"
        >
          <Link href={`/initiatives/${initiative.id}`}>
            {t("card.viewDetails")}
            <ArrowUpRight className="size-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </Link>
        </Button>
      </div>
    </motion.article>
  );
}
