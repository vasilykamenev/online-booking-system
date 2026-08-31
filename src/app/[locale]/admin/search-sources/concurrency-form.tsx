"use client";

import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/routing";
import { updateReindexConcurrency, type ReindexConcurrencyActionState } from "@/server/actions/admin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: ReindexConcurrencyActionState = {};

/** Global "how many candidates the indexer processes at once" knob — same
 *  `useActionState` + plain form pattern as `CommissionForm` (editing one stored numeric
 *  `platform_settings` field), not `ReindexButton`'s `useTransition` pattern (that one triggers a
 *  background job; this one just saves a setting). */
export function ConcurrencyForm({ currentConcurrency }: { currentConcurrency: number }) {
  const t = useTranslations("admin.searchSources.concurrency");
  const locale = useLocale() as Locale;
  const prevStateRef = useRef(initialState);
  const [state, formAction, isPending] = useActionState(
    updateReindexConcurrency.bind(null, locale),
    initialState,
  );

  useEffect(() => {
    if (state !== prevStateRef.current) {
      prevStateRef.current = state;
      if (state.success) toast.success(t("saved"));
    }
  }, [state, t]);

  return (
    <form action={formAction} className="flex flex-col gap-2 sm:flex-row sm:items-end sm:gap-3">
      <div className="flex flex-col gap-2">
        <Label htmlFor="concurrency">{t("label")}</Label>
        <Input
          id="concurrency"
          name="concurrency"
          type="number"
          step="1"
          min="1"
          max="10"
          defaultValue={currentConcurrency}
          required
          className="w-24"
        />
      </div>

      {state.error && <p className="text-sm text-destructive">{t(`errors.${state.error}`)}</p>}

      <Button type="submit" disabled={isPending} variant="outline" className="rounded-full sm:w-fit">
        {t("save")}
      </Button>
    </form>
  );
}
