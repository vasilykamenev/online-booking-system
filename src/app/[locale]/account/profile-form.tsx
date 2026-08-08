"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import type { Locale } from "@/i18n/routing";
import type { Profile } from "@/server/queries/profile";
import { updateProfile, type ProfileActionState } from "@/server/actions/profile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const initialState: ProfileActionState = {};

export function ProfileForm({ profile, locale }: { profile: Profile; locale: Locale }) {
  const t = useTranslations("account.profile");
  const [state, formAction, isPending] = useActionState(
    updateProfile.bind(null, locale),
    initialState,
  );

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-soft md:p-8">
      <h1 className="text-xl font-medium tracking-tight">{t("title")}</h1>
      <p className="mt-1 text-sm font-light text-muted-foreground">{t("subtitle")}</p>

      <form action={formAction} className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-2 sm:col-span-2">
          <Label htmlFor="fullName">{t("fullName")}</Label>
          <Input id="fullName" name="fullName" defaultValue={profile.fullName ?? ""} required />
        </div>

        <div className="flex flex-col gap-2 sm:col-span-2">
          <Label htmlFor="email">{t("email")}</Label>
          <Input id="email" value={profile.email} disabled readOnly />
        </div>

        <div className="flex flex-col gap-2">
          <Label>{t("locale")}</Label>
          <Select name="locale" defaultValue={profile.locale}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ru">Русский</SelectItem>
              <SelectItem value="en">English</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="currency">{t("currency")}</Label>
          <Input
            id="currency"
            name="currency"
            defaultValue={profile.currency}
            maxLength={3}
            className="uppercase"
            required
          />
        </div>

        {state.error && (
          <p className="text-sm text-destructive sm:col-span-2">{state.error}</p>
        )}
        {state.success && (
          <p className="text-sm text-primary sm:col-span-2">{t("saved")}</p>
        )}

        <Button
          type="submit"
          size="lg"
          disabled={isPending}
          className="rounded-full sm:col-span-2 sm:w-fit"
        >
          {t("save")}
        </Button>
      </form>
    </div>
  );
}
