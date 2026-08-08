"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import type { Locale } from "@/i18n/routing";
import { Link } from "@/i18n/navigation";
import { signIn, type AuthActionState } from "@/server/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: AuthActionState = {};

export function LoginForm({ locale }: { locale: Locale }) {
  const t = useTranslations("auth.login");
  const tErrors = useTranslations("auth.errors");
  const [state, formAction, isPending] = useActionState(signIn.bind(null, locale), initialState);

  return (
    <div className="rounded-2xl border border-border bg-card p-7 shadow-soft md:p-9">
      <h1 className="text-2xl font-light tracking-tight">{t("title")}</h1>
      <p className="mt-2 text-sm font-light text-muted-foreground">{t("subtitle")}</p>

      <form action={formAction} className="mt-7 space-y-5">
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
          <div className="flex items-center justify-between">
            <Label htmlFor="password">{t("password")}</Label>
            <Link
              href="/auth/forgot-password"
              className="text-xs text-primary hover:underline"
            >
              {t("forgotPassword")}
            </Link>
          </div>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            placeholder={t("passwordPlaceholder")}
          />
        </div>

        {state.error && <p className="text-sm text-destructive">{tErrors(state.error)}</p>}

        <Button type="submit" size="lg" disabled={isPending} className="w-full rounded-full">
          {t("submit")}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm font-light text-muted-foreground">
        {t("noAccount")}{" "}
        <Link href="/auth/register" className="text-primary hover:underline">
          {t("registerLink")}
        </Link>
      </p>
    </div>
  );
}
