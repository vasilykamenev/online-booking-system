"use client";

import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/routing";
import { updateIndexingSettings, type IndexingSettingsActionState } from "@/server/actions/admin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: IndexingSettingsActionState = {};

/** Two global "how the background reindexer runs" knobs — same `useActionState` + plain form
 *  pattern as `CommissionForm` (editing stored numeric `platform_settings` fields), not
 *  `ReindexButton`'s `useTransition` pattern (that one triggers a background job; this one just
 *  saves settings). */
export function IndexingSettingsForm({
  currentConcurrency,
  currentMaxDurationSeconds,
}: {
  currentConcurrency: number;
  currentMaxDurationSeconds: number;
}) {
  const t = useTranslations("admin.searchSources.indexingSettings");
  const locale = useLocale() as Locale;
  const prevStateRef = useRef(initialState);
  const [state, formAction, isPending] = useActionState(
    updateIndexingSettings.bind(null, locale),
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
        <Label htmlFor="concurrency">{t("concurrencyLabel")}</Label>
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

      <div className="flex flex-col gap-2">
        <Label htmlFor="maxDurationSeconds">{t("maxDurationLabel")}</Label>
        <Input
          id="maxDurationSeconds"
          name="maxDurationSeconds"
          type="number"
          step="1"
          min="30"
          max="280"
          defaultValue={currentMaxDurationSeconds}
          required
          className="w-28"
        />
      </div>

      {state.error && <p className="text-sm text-destructive">{t(`errors.${state.error}`)}</p>}

      <Button type="submit" disabled={isPending} variant="outline" className="rounded-full sm:w-fit">
        {t("save")}
      </Button>
    </form>
  );
}
