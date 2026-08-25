"use client";

import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/routing";
import { useRouter } from "@/i18n/navigation";
import { addManualSourceUrls, type AddManualUrlsActionResult } from "@/server/actions/admin";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const initialState: AddManualUrlsActionResult = {};

/** Manual-entry fallback for a source `resyncSearchSourceUrls` can't fully help — no sitemap, and
 *  nothing (or nothing useful) reachable by following links from the homepage either. */
export function AddManualUrlsForm({ sourceId }: { sourceId: string }) {
  const t = useTranslations("admin.searchSources.urlRegistry.manualAdd");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const prevStateRef = useRef(initialState);
  const [state, formAction, isPending] = useActionState(
    addManualSourceUrls.bind(null, locale, sourceId),
    initialState,
  );

  useEffect(() => {
    if (state === prevStateRef.current) return;
    prevStateRef.current = state;

    if (state.error) {
      toast.error(t(`errors.${state.error}`));
      return;
    }
    if (state.added !== undefined) {
      toast.success(t("added", { count: state.added }));
      if (state.skipped) toast.warning(t("skipped", { count: state.skipped }));
      formRef.current?.reset();
      router.refresh();
    }
  }, [state, t, router]);

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <Label htmlFor="manual-urls">{t("label")}</Label>
        <Textarea
          id="manual-urls"
          name="urls"
          required
          rows={4}
          placeholder={t("placeholder")}
          className="font-mono text-xs"
        />
        <p className="text-xs font-light text-muted-foreground">{t("hint")}</p>
      </div>
      <Button type="submit" disabled={isPending} className="w-fit rounded-full">
        {t("submit")}
      </Button>
    </form>
  );
}
