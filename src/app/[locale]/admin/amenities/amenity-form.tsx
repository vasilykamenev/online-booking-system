"use client";

import { useActionState, useEffect, useRef } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/routing";
import { useRouter } from "@/i18n/navigation";
import { createAmenity, type AmenityActionState } from "@/server/actions/admin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: AmenityActionState = {};

export function AmenityForm() {
  const t = useTranslations("admin.amenities.form");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const prevStateRef = useRef(initialState);
  const [state, formAction, isPending] = useActionState(
    createAmenity.bind(null, locale),
    initialState,
  );

  useEffect(() => {
    if (state !== prevStateRef.current) {
      prevStateRef.current = state;
      if (!state.error) {
        formRef.current?.reset();
        router.refresh();
      }
    }
  }, [state, router]);

  return (
    <form ref={formRef} action={formAction} className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-2">
        <Label htmlFor="key">{t("key")}</Label>
        <Input id="key" name="key" placeholder={t("keyPlaceholder")} required className="w-56" />
      </div>
      <Button type="submit" disabled={isPending} className="rounded-full">
        {t("add")}
      </Button>
      {state.error && <p className="text-sm text-destructive">{t(`errors.${state.error}`)}</p>}
    </form>
  );
}
