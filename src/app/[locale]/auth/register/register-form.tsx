"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import type { Locale } from "@/i18n/routing";
import { Link } from "@/i18n/navigation";
import { signUp, type AuthActionState } from "@/server/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: AuthActionState = {};

export function RegisterForm({ locale }: { locale: Locale }) {
  const t = useTranslations("auth.register");
  const tErrors = useTranslations("auth.errors");
  const [state, formAction, isPending] = useActionState(signUp.bind(null, locale), initialState);

  if (state.success) {
    return (
      <div className="rounded-2xl border border-border bg-card p-7 text-center shadow-soft md:p-9">
        <h1 className="text-2xl font-light tracking-tight">{t("successTitle")}</h1>
        <p className="mt-2 text-sm font-light text-muted-foreground">
          {t("successDescription")}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-7 shadow-soft md:p-9">
      <h1 className="text-2xl font-light tracking-tight">{t("title")}</h1>
      <p className="mt-2 text-sm font-light text-muted-foreground">{t("subtitle")}</p>

      <form action={formAction} className="mt-7 space-y-5">
        <div className="flex flex-col gap-2">
          <Label htmlFor="fullName">{t("fullName")}</Label>
          <Input
            id="fullName"
            name="fullName"
            autoComplete="name"
            required
            placeholder={t("fullNamePlaceholder")}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="email">{t("email")}</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder={t("emailPlaceholder")}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="password">{t("password")}</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            placeholder={t("passwordPlaceholder")}
          />
          <p className="text-xs font-light text-muted-foreground">{t("passwordHint")}</p>
        </div>

        {state.error && <p className="text-sm text-destructive">{tErrors(state.error)}</p>}

        <Button type="submit" size="lg" disabled={isPending} className="w-full rounded-full">
          {t("submit")}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm font-light text-muted-foreground">
        {t("hasAccount")}{" "}
        <Link href="/auth/login" className="text-primary hover:underline">
          {t("loginLink")}
        </Link>
      </p>
    </div>
  );
}
