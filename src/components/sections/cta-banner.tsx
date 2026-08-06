"use client";

import { motion } from "motion/react";
import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

export function CtaBanner() {
  const t = useTranslations("cta");

  return (
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
          {t("title")}
        </motion.h2>
        <motion.p
          initial={{ opacity: 0, y: 15 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: 0.5, delay: 0.15 }}
          className="mt-4 max-w-md text-sm font-light leading-relaxed text-banner-foreground/80 md:text-base"
        >
          {t("subtitle")}
        </motion.p>
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="mt-8 flex flex-col gap-3 sm:flex-row"
        >
          <a href="#vessels">
            <Button
              size="lg"
              className="w-full gap-2 rounded-full bg-white text-banner transition-transform duration-300 hover:scale-[1.03] hover:bg-white/90 active:scale-[0.98] sm:w-auto"
            >
              {t("primary")}
              <ArrowRight className="size-4" />
            </Button>
          </a>
          <Button
            variant="outline"
            size="lg"
            className="w-full rounded-full border-white/30 bg-white/10 text-banner-foreground backdrop-blur-md transition-transform duration-300 hover:scale-[1.03] hover:bg-white/20 hover:text-banner-foreground active:scale-[0.98] sm:w-auto"
          >
            {t("secondary")}
          </Button>
        </motion.div>
      </div>
    </section>
  );
}
