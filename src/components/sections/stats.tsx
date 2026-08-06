"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useInView, useMotionValue, useSpring } from "motion/react";
import { useLocale, useTranslations } from "next-intl";

const values = [
  { value: 240, suffix: "+", key: "vessels" },
  { value: 38, suffix: "", key: "countries" },
  { value: 12000, suffix: "+", key: "guests" },
  { value: 56, suffix: "", key: "expeditions" },
] as const;

export function Stats() {
  const t = useTranslations("stats");
  const locale = useLocale();

  return (
    <section className="border-b border-border bg-secondary/30 py-14 md:py-16">
      <div className="container-page">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
          {values.map((item, index) => (
            <motion.div
              key={item.key}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.4 }}
              transition={{ duration: 0.5, delay: index * 0.08 }}
              className="text-center md:text-left"
            >
              <div className="text-3xl font-light tracking-tight text-foreground md:text-4xl">
                <AnimatedNumber
                  value={item.value}
                  suffix={item.suffix}
                  locale={locale}
                />
              </div>
              <div className="mt-1 text-xs font-light text-muted-foreground md:text-sm">
                {t(item.key)}
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function AnimatedNumber({
  value,
  suffix,
  locale,
}: {
  value: number;
  suffix: string;
  locale: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const isInView = useInView(ref, { once: true, amount: 0.5 });
  const motionValue = useMotionValue(0);
  const springValue = useSpring(motionValue, { damping: 30, stiffness: 60 });
  const [display, setDisplay] = useState("0");

  useEffect(() => {
    if (isInView) motionValue.set(value);
  }, [isInView, value, motionValue]);

  useEffect(() => {
    const unsubscribe = springValue.on("change", (latest) => {
      setDisplay(Math.round(latest).toLocaleString(locale));
    });
    return unsubscribe;
  }, [springValue, locale]);

  return (
    <span ref={ref}>
      {display}
      {suffix}
    </span>
  );
}
