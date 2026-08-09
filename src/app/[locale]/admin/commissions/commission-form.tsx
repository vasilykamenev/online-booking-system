"use client";

import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/routing";
import { updateCommissionRate, type CommissionActionState } from "@/server/actions/admin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: CommissionActionState = {};

export function CommissionForm({ currentRatePercent }: { currentRatePercent: number }) {
  const t = useTranslations("admin.commissions");
  const locale = useLocale() as Locale;
  const prevStateRef = useRef(initialState);
  const [state, formAction, isPending] = useActionState(
    updateCommissionRate.bind(null, locale),
    initialState,
  );

  useEffect(() => {
    if (state !== prevStateRef.current) {
      prevStateRef.current = state;
      if (state.success) toast.success(t("saved"));
    }
  }, [state, t]);

  return (
    <form action={formAction} className="flex flex-col gap-4 sm:flex-row sm:items-end sm:gap-3">
      <div className="flex flex-col gap-2">
        <Label htmlFor="ratePercent">{t("rateLabel")}</Label>
        <div className="relative w-40">
          <Input
            id="ratePercent"
            name="ratePercent"
            type="number"
            step="0.1"
            min="0"
            max="100"
            defaultValue={currentRatePercent}
            required
          />
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
            %
          </span>
        </div>
      </div>

      {state.error && <p className="text-sm text-destructive">{t(`errors.${state.error}`)}</p>}

      <Button type="submit" disabled={isPending} className="rounded-full sm:w-fit">
        {t("save")}
      </Button>
    </form>
  );
}
