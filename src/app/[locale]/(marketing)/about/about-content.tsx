"use client";

import Image from "next/image";
import { motion } from "motion/react";
import { ArrowRight, Compass, ShieldCheck, Sparkles, Waves } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";

const valueIcons = [ShieldCheck, Compass, Waves];

export function AboutContent() {
  const t = useTranslations("about");
  const values = t.raw("values.items") as { title: string; description: string }[];

  return (
    <>
      <section className="relative isolate">
        <div className="relative h-[56vh] min-h-[380px] w-full overflow-hidden">
          <Image
            src="/images/hero/sailing-yacht.jpg"
            alt=""
            fill
            priority
            sizes="100vw"
            className="object-cover"
          />
          <div className="absolute inset-0 bg-hero-overlay" />
        </div>

        <div className="container-page absolute inset-x-0 bottom-14 z-10 text-white md:bottom-20">
          <motion.span
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, duration: 0.5 }}
            className="mb-4 block text-[11px] font-medium uppercase tracking-[0.15em] text-white/75"
          >
            {t("eyebrow")}
          </motion.span>
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.7 }}
            className="max-w-2xl text-4xl font-light leading-[1.1] tracking-tight text-balance md:text-5xl lg:text-6xl"
          >
            {t("title")}
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35, duration: 0.6 }}
            className="mt-5 max-w-lg text-sm font-light leading-relaxed text-white/85 md:text-base"
          >
            {t("subtitle")}
          </motion.p>
        </div>
      </section>

      <section className="bg-background py-24 lg:py-32">
        <div className="container-page grid grid-cols-1 items-center gap-12 lg:grid-cols-2 lg:gap-20">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.6 }}
          >
            <span className="uppercase-label mb-4 block">
              {t("mission.eyebrow")}
            </span>
            <h2 className="text-3xl font-light tracking-tight text-balance md:text-4xl">
              {t("mission.title")}
            </h2>
            <p className="mt-4 text-sm font-light leading-relaxed text-muted-foreground md:text-base">
              {t("mission.description")}
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.6, delay: 0.15 }}
            className="relative flex aspect-[4/3] items-center justify-center overflow-hidden rounded-2xl border border-border bg-secondary/30"
          >
            <Image
              src="/images/hero/catamaran-sunset.jpg"
              alt=""
              fill
              sizes="(min-width: 1024px) 50vw, 100vw"
              className="object-cover"
            />
          </motion.div>
        </div>
      </section>

      <section className="bg-secondary/30 py-24 lg:py-32">
        <div className="container-page">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.6 }}
            className="mx-auto mb-16 max-w-2xl text-center"
          >
            <span className="uppercase-label mb-4 block">
              {t("values.eyebrow")}
            </span>
            <h2 className="text-3xl font-light tracking-tight text-balance md:text-4xl lg:text-5xl">
              {t("values.title")}
            </h2>
          </motion.div>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
            {values.map((item, index) => {
              const Icon = valueIcons[index] ?? Sparkles;
              return (
                <motion.div
                  key={item.title}
                  initial={{ opacity: 0, y: 24 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.3 }}
                  transition={{ duration: 0.5, delay: index * 0.1 }}
                  className="rounded-2xl border border-border bg-card p-7 shadow-soft"
                >
                  <div className="flex size-11 items-center justify-center rounded-xl bg-primary/10">
                    <Icon className="size-5 text-primary" strokeWidth={1.5} />
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

      <section className="relative overflow-hidden bg-banner py-24 lg:py-28">
        <div aria-hidden className="absolute inset-0 overflow-hidden">
          <div className="animate-gradient-drift absolute -left-[10%] -top-[20%] size-[28rem] rounded-full bg-brass/40 blur-3xl" />
          <div
            className="animate-gradient-drift absolute -bottom-[25%] -right-[10%] size-[32rem] rounded-full bg-brass/30 blur-3xl"
            style={{ animationDelay: "-7s", animationDirection: "reverse" }}
          />
        </div>
        <div className="container-page relative z-10 flex flex-col items-center text-center">
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.4 }}
            transition={{ duration: 0.6 }}
            className="max-w-2xl text-3xl font-light tracking-tight text-balance text-banner-foreground md:text-4xl lg:text-5xl"
          >
            {t("cta.title")}
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 15 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.4 }}
            transition={{ duration: 0.5, delay: 0.15 }}
            className="mt-4 max-w-md text-sm font-light leading-relaxed text-banner-foreground/80 md:text-base"
          >
            {t("cta.subtitle")}
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.4 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="mt-8 flex flex-col gap-3 sm:flex-row"
          >
            <Link href="/#vessels">
              <Button
                size="lg"
                className="w-full gap-2 rounded-full bg-white text-banner transition-transform duration-300 hover:scale-[1.03] hover:bg-white/90 active:scale-[0.98] sm:w-auto"
              >
                {t("cta.primary")}
                <ArrowRight className="size-4" />
              </Button>
            </Link>
            <Link href="/contact">
              <Button
                variant="outline"
                size="lg"
                className="w-full rounded-full border-white/30 bg-white/10 text-banner-foreground backdrop-blur-md transition-transform duration-300 hover:scale-[1.03] hover:bg-white/20 hover:text-banner-foreground active:scale-[0.98] sm:w-auto"
              >
                {t("cta.secondary")}
              </Button>
            </Link>
          </motion.div>
        </div>
      </section>
    </>
  );
}
