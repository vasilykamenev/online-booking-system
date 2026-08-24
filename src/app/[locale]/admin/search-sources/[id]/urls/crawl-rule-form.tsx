"use client";

import { useActionState, useEffect, useRef } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/routing";
import { useRouter } from "@/i18n/navigation";
import { createCrawlRule, type CrawlRuleActionState } from "@/server/actions/admin";
import { urlClassificationValues } from "@/lib/validation/admin";
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

const initialState: CrawlRuleActionState = {};

export function CrawlRuleForm({ sourceId }: { sourceId: string }) {
  const t = useTranslations("admin.searchSources.crawlRules");
  const tClassification = useTranslations("admin.searchSources.classification");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const prevStateRef = useRef(initialState);
  const [state, formAction, isPending] = useActionState(
    createCrawlRule.bind(null, locale, sourceId),
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
        <Label htmlFor="pattern">{t("pattern")}</Label>
        <Input id="pattern" name="pattern" placeholder={t("patternPlaceholder")} required className="w-56" />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="classification">{t("classification")}</Label>
        <Select name="classification" defaultValue={urlClassificationValues[0]}>
          <SelectTrigger id="classification" className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {urlClassificationValues.map((value) => (
              <SelectItem key={value} value={value}>
                {tClassification(value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="priority">{t("priority")}</Label>
        <Input id="priority" name="priority" type="number" defaultValue={0} className="w-24" />
      </div>
      <Button type="submit" disabled={isPending} className="rounded-full">
        {t("add")}
      </Button>
      {state.error && <p className="text-sm text-destructive">{t(`errors.${state.error}`)}</p>}
    </form>
  );
}
