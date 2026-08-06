"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Image from "next/image";
import { motion, AnimatePresence } from "motion/react";
import { ArrowRight, MapPin, CalendarRange, Users, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { heroSlides } from "@/data/hero-slides";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const SLIDE_DURATION = 6000;

export function Hero() {
  const t = useTranslations("hero");
  const [current, setCurrent] = useState(0);

  const nextSlide = useCallback(() => {
    setCurrent((prev) => (prev + 1) % heroSlides.length);
  }, []);

  useEffect(() => {
    const interval = setInterval(nextSlide, SLIDE_DURATION);
    return () => clearInterval(interval);
  }, [nextSlide]);

  return (
    <section className="relative isolate">
      <div className="relative h-[92vh] min-h-[560px] w-full overflow-hidden">
        <AnimatePresence mode="popLayout">
          <motion.div
            key={current}
            initial={{ opacity: 0, scale: 1.04 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1, ease: "easeInOut" }}
            className="absolute inset-0"
          >
            <Image
              src={heroSlides[current].image}
              alt={heroSlides[current].alt}
              fill
              priority={current === 0}
              sizes="100vw"
              className="object-cover"
            />
            <div className="absolute inset-0 bg-hero-overlay" />
          </motion.div>
        </AnimatePresence>

        <div className="container-page absolute inset-x-0 bottom-36 z-10 text-white md:bottom-44">
          <motion.span
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.5 }}
            className="mb-4 block text-[11px] font-medium uppercase tracking-[0.15em] text-white/75"
          >
            {t("eyebrow")}
          </motion.span>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.7 }}
            className="flex max-w-xl flex-col text-5xl font-light leading-[1.05] tracking-tight text-balance md:text-6xl lg:text-7xl"
          >
            <span>{t("titleLine1")}</span>
            <span>{t("titleLine2")}</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.45, duration: 0.6 }}
            className="mt-5 max-w-md text-sm font-light leading-relaxed text-white/85 md:text-base"
          >
            {t("subtitle")}
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6, duration: 0.5 }}
            className="mt-8 flex items-center gap-6"
          >
            <a
              href="#vessels"
              className="group flex items-center gap-3 rounded-full bg-white px-6 py-3.5 text-sm font-medium tracking-wide text-foreground transition-colors hover:bg-white/90"
            >
              {t("cta")}
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </a>

            <div className="hidden items-center gap-2 sm:flex">
              {heroSlides.map((slide, index) => (
                <button
                  key={slide.image}
                  onClick={() => setCurrent(index)}
                  aria-label={`Slide ${index + 1}`}
                  className="h-[2px] w-8 overflow-hidden rounded-full bg-white/30"
                >
                  <span
                    className={`block h-full bg-white transition-all duration-500 ${
                      index === current ? "w-full" : "w-0"
                    }`}
                  />
                </button>
              ))}
            </div>
          </motion.div>
        </div>
      </div>

      <div className="container-page relative z-20 -mt-10 md:-mt-14">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7, duration: 0.6 }}
          className="grid grid-cols-1 divide-y divide-white/15 overflow-hidden rounded-2xl border border-white/20 bg-card/55 shadow-glow backdrop-blur-2xl sm:grid-cols-[1fr_1fr_1fr_auto] sm:divide-x sm:divide-y-0"
        >
          <SearchField
            icon={<MapPin className="size-4" strokeWidth={1.5} />}
            label={t("search.destination")}
            placeholder={t("search.destinationPlaceholder")}
          />
          <SearchField
            icon={<CalendarRange className="size-4" strokeWidth={1.5} />}
            label={t("search.dates")}
            placeholder={t("search.datesPlaceholder")}
          />
          <SearchField
            icon={<Users className="size-4" strokeWidth={1.5} />}
            label={t("search.guests")}
            placeholder={t("search.guestsPlaceholder")}
          />
          <div className="flex items-center p-3">
            <Button size="lg" className="w-full gap-2 rounded-xl sm:w-auto">
              <Search className="size-4" strokeWidth={1.5} />
              <span className="sm:hidden">{t("search.submit")}</span>
            </Button>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

function SearchField({
  icon,
  label,
  placeholder,
}: {
  icon: ReactNode;
  label: string;
  placeholder: string;
}) {
  return (
    <label className="flex flex-col gap-1 px-5 py-3.5">
      <span className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </span>
      <Input
        placeholder={placeholder}
        className="h-auto border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0 placeholder:text-muted-foreground/60 dark:bg-transparent"
      />
    </label>
  );
}
