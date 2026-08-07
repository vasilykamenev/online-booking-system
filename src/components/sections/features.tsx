"use client";

import { motion } from "motion/react";
import { ShieldCheck, TrendingUp, CalendarCheck, Headset } from "lucide-react";
import { useTranslations } from "next-intl";

const icons = [ShieldCheck, TrendingUp, CalendarCheck, Headset];

export function Features() {
  const t = useTranslations("features");
  const items = t.raw("items") as { title: string; description: string }[];
  const [lead, ...rest] = items;
  const LeadIcon = icons[0];

  return (
    <section id="why-us" className="bg-secondary/30 py-24 lg:py-32">
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

        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-2xl bg-border sm:grid-cols-2 lg:grid-cols-3">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.5 }}
            className="relative overflow-hidden bg-background p-8 sm:col-span-2 lg:col-span-3 lg:flex lg:items-center lg:gap-10 lg:p-10"
          >
            <div
              aria-hidden
              className="pointer-events-none absolute -right-10 -top-16 size-56 rounded-full bg-primary/5 blur-2xl"
            />
            <LeadIcon
              className="relative size-14 shrink-0 text-primary/20 lg:size-20"
              strokeWidth={1}
            />
            <div className="relative mt-5 lg:mt-0">
              <h3 className="text-lg font-medium tracking-tight lg:text-xl">
                {lead.title}
              </h3>
              <p className="mt-2 max-w-md text-sm font-light leading-relaxed text-muted-foreground">
                {lead.description}
              </p>
            </div>
          </motion.div>

          {rest.map((item, index) => {
            const Icon = icons[index + 1];
            return (
              <motion.div
                key={item.title}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.3 }}
                transition={{ duration: 0.5, delay: index * 0.08 }}
                className="bg-background p-8 transition-colors hover:bg-accent/40"
              >
                <div className="flex size-11 items-center justify-center rounded-xl bg-accent">
                  <Icon
                    className="size-5 text-accent-foreground"
                    strokeWidth={1.5}
                  />
                </div>
                <h3 className="mt-5 text-base font-medium tracking-tight">
                  {item.title}
                </h3>
                <p className="mt-2 text-sm font-light leading-relaxed text-muted-foreground">
                  {item.description}
                </p>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
