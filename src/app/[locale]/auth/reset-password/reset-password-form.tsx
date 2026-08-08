"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import type { Locale } from "@/i18n/routing";
import { updatePassword, type AuthActionState } from "@/server/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: AuthActionState = {};

export function ResetPasswordForm({ locale }: { locale: Locale }) {
  const t = useTranslations("auth.resetPassword");
  const tErrors = useTranslations("auth.errors");
  const [state, formAction, isPending] = useActionState(
    updatePassword.bind(null, locale),
    initialState,
  );

  return (
    <div className="rounded-2xl border border-border bg-card p-7 shadow-soft md:p-9">
      <h1 className="text-2xl font-light tracking-tight">{t("title")}</h1>
      <p className="mt-2 text-sm font-light text-muted-foreground">{t("subtitle")}</p>

      <form action={formAction} className="mt-7 space-y-5">
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
        </div>

        {state.error && <p className="text-sm text-destructive">{tErrors(state.error)}</p>}

        <Button type="submit" size="lg" disabled={isPending} className="w-full rounded-full">
          {t("submit")}
        </Button>
      </form>
    </div>
  );
}
