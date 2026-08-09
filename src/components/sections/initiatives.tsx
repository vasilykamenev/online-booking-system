"use client";

import { motion } from "motion/react";
import { ArrowUpRight, MapPin } from "lucide-react";
import { useTranslations } from "next-intl";
import { initiativeIcons } from "@/data/initiatives";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface InitiativeContent {
  tag: string;
  title: string;
  region: string;
  description: string;
}

export function Initiatives() {
  const t = useTranslations("initiatives");
  const items = t.raw("items") as InitiativeContent[];

  return (
    <section id="initiatives" className="bg-background py-24 lg:py-32">
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

        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {items.map((item, index) => {
            const Icon = initiativeIcons[index];
            return (
              <motion.article
                key={item.title}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.2 }}
                transition={{ duration: 0.5, delay: index * 0.1 }}
                whileHover={{ y: -6 }}
                className="group flex flex-col rounded-2xl border border-border bg-card p-7 shadow-soft transition-[box-shadow,border-color] duration-300 hover:border-primary/25 hover:shadow-glow"
                style={{ transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)" }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex size-11 items-center justify-center rounded-xl bg-primary/10 transition-colors duration-300 group-hover:bg-primary group-hover:text-primary-foreground">
                    <Icon
                      className="size-5 text-primary transition-colors duration-300 group-hover:text-primary-foreground"
                      strokeWidth={1.5}
                    />
                  </div>
                  <Badge variant="secondary" className="font-normal">
                    {item.tag}
                  </Badge>
                </div>

                <h3 className="mt-5 text-base font-medium tracking-tight">
                  {item.title}
                </h3>
                <div className="mt-1 flex items-center gap-1 text-xs font-light text-muted-foreground">
                  <MapPin className="size-3" strokeWidth={1.5} />
                  {item.region}
                </div>
                <p className="mt-3 flex-1 text-sm font-light leading-relaxed text-muted-foreground">
                  {item.description}
                </p>

                <Button
                  asChild
                  variant="ghost"
                  size="sm"
                  className="mt-5 w-fit gap-1 self-start px-0 text-xs text-primary hover:bg-transparent hover:text-primary/80"
                >
                  <Link href="/initiatives">
                    {t("respond")}
                    <ArrowUpRight className="size-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                  </Link>
                </Button>
              </motion.article>
            );
          })}
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="mt-12 flex justify-center"
        >
          <Button asChild variant="outline" size="lg" className="gap-2 rounded-full">
            <Link href="/initiatives">
              {t("cta")}
              <ArrowUpRight className="size-4" />
            </Link>
          </Button>
        </motion.div>
      </div>
    </section>
  );
}
