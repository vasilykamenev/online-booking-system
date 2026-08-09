"use client";

import { useActionState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/routing";
import { createInitiative, type InitiativeActionState } from "@/server/actions/initiatives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const initialState: InitiativeActionState = {};

export function InitiativeForm() {
  const t = useTranslations("initiativesPage.form");
  const locale = useLocale() as Locale;
  const [state, formAction, isPending] = useActionState(
    createInitiative.bind(null, locale),
    initialState,
  );

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-soft md:p-8">
      <form action={formAction} className="grid grid-cols-1 gap-5">
        <div className="flex flex-col gap-2">
          <Label htmlFor="title">{t("titleField")}</Label>
          <Input id="title" name="title" required />
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="topic">{t("topic")}</Label>
            <Input id="topic" name="topic" placeholder={t("topicPlaceholder")} required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="region">{t("region")}</Label>
            <Input id="region" name="region" placeholder={t("regionPlaceholder")} required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="activityType">{t("activityType")}</Label>
            <Input
              id="activityType"
              name="activityType"
              placeholder={t("activityTypePlaceholder")}
              required
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="description">{t("description")}</Label>
          <Textarea id="description" name="description" rows={6} required />
        </div>

        {state.error && <p className="text-sm text-destructive">{t(`errors.${state.error}`)}</p>}

        <Button type="submit" size="lg" disabled={isPending} className="rounded-full sm:w-fit">
          {t("submit")}
        </Button>
      </form>
    </div>
  );
}
