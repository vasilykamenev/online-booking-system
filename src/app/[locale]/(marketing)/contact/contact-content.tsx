"use client";

import { useState, type FormEvent } from "react";
import { motion } from "motion/react";
import { Headset, Mail, MapPin, Send } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const channelIcons = [Mail, Headset, MapPin] as const;
const channelKeys = ["email", "support", "office"] as const;

export function ContactContent() {
  const t = useTranslations("contact");
  const [isSubmitting, setIsSubmitting] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    const form = event.currentTarget;

    window.setTimeout(() => {
      toast.success(t("form.success"));
      form.reset();
      setIsSubmitting(false);
    }, 400);
  }

  return (
    <section className="bg-background pt-40 pb-24 lg:pt-48 lg:pb-32">
      <div className="container-page">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="mx-auto mb-16 max-w-2xl text-center"
        >
          <span className="uppercase-label mb-4 block">{t("eyebrow")}</span>
          <h1 className="text-4xl font-light tracking-tight text-balance md:text-5xl">
            {t("title")}
          </h1>
          <p className="mt-4 text-sm font-light leading-relaxed text-muted-foreground md:text-base">
            {t("subtitle")}
          </p>
        </motion.div>

        <div className="mx-auto grid max-w-4xl grid-cols-1 gap-10 lg:grid-cols-[1.3fr_1fr] lg:gap-16">
          <motion.form
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            onSubmit={handleSubmit}
            className="space-y-5 rounded-2xl border border-border bg-card p-7 shadow-soft md:p-9"
          >
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="name">{t("form.name")}</Label>
                <Input
                  id="name"
                  name="name"
                  required
                  placeholder={t("form.namePlaceholder")}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">{t("form.email")}</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  required
                  placeholder={t("form.emailPlaceholder")}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="topic">{t("form.topic")}</Label>
              <Input
                id="topic"
                name="topic"
                required
                placeholder={t("form.topicPlaceholder")}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="message">{t("form.message")}</Label>
              <Textarea
                id="message"
                name="message"
                required
                rows={5}
                placeholder={t("form.messagePlaceholder")}
              />
            </div>

            <Button
              type="submit"
              size="lg"
              disabled={isSubmitting}
              className="w-full gap-2 rounded-full sm:w-auto"
            >
              {t("form.submit")}
              <Send className="size-4" strokeWidth={1.5} />
            </Button>
          </motion.form>

          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="space-y-6"
          >
            <span className="uppercase-label block">
              {t("channels.eyebrow")}
            </span>
            <ul className="space-y-5">
              {channelKeys.map((key, index) => {
                const Icon = channelIcons[index];
                return (
                  <li key={key} className="flex items-start gap-4">
                    <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                      <Icon className="size-5 text-primary" strokeWidth={1.5} />
                    </div>
                    <div>
                      <p className="text-sm font-medium tracking-tight">
                        {t(`channels.${key}.title`)}
                      </p>
                      <p className="mt-0.5 text-sm font-light text-muted-foreground">
                        {t(`channels.${key}.value`)}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
