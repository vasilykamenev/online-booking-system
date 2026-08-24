"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/routing";
import { useRouter } from "@/i18n/navigation";
import { createCrawlRule, type CrawlRuleActionState } from "@/server/actions/admin";
import { crawlRulePatternTypeValues, urlClassificationValues } from "@/lib/validation/admin";
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
  const tPatternType = useTranslations("admin.searchSources.crawlRules.patternType");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const prevStateRef = useRef(initialState);
  const [patternType, setPatternType] = useState<(typeof crawlRulePatternTypeValues)[number]>(
    crawlRulePatternTypeValues[0],
  );
  const [state, formAction, isPending] = useActionState(
    createCrawlRule.bind(null, locale, sourceId),
    initialState,
  );

  // `formRef.current?.reset()` (an effect, below) only resets the form's uncontrolled DOM inputs —
  // `patternType` is React state driving a controlled Select, so it needs its own reset. Done at
  // render time (not inside the effect) for the same reason `search-source-form.tsx` does this:
  // calling setState synchronously inside an effect body triggers a cascading extra render.
  const [adjustedForState, setAdjustedForState] = useState(state);
  if (state !== adjustedForState) {
    setAdjustedForState(state);
    if (!state.error) setPatternType(crawlRulePatternTypeValues[0]);
  }

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
        <Label htmlFor="patternType">{t("patternType.label")}</Label>
        <Select
          name="patternType"
          value={patternType}
          onValueChange={(value) => setPatternType(value as (typeof crawlRulePatternTypeValues)[number])}
        >
          <SelectTrigger id="patternType" className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {crawlRulePatternTypeValues.map((value) => (
              <SelectItem key={value} value={value}>
                {tPatternType(value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="pattern">{t("pattern")}</Label>
        <Input
          id="pattern"
          name="pattern"
          placeholder={patternType === "REGEX" ? t("patternPlaceholderRegex") : t("patternPlaceholder")}
          required
          className="w-56 font-mono text-xs"
        />
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
      <p className="w-full text-xs font-light text-muted-foreground">
        {patternType === "REGEX" ? t("patternTypeHintRegex") : t("patternTypeHintPrefix")}
      </p>
    </form>
  );
}
