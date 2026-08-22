"use client";

import { useActionState, useEffect, useRef } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/routing";
import { useRouter } from "@/i18n/navigation";
import { createSearchSource, type SearchSourceActionState } from "@/server/actions/admin";
import {
  searchProcessingTypeValues,
  searchSourceTypeValues,
} from "@/lib/validation/admin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const initialState: SearchSourceActionState = {};

export function SearchSourceForm() {
  const t = useTranslations("admin.searchSources.form");
  const tProcessing = useTranslations("admin.searchSources.processingType");
  const tSourceType = useTranslations("admin.searchSources.sourceType");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const prevStateRef = useRef(initialState);
  const [state, formAction, isPending] = useActionState(
    createSearchSource.bind(null, locale),
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
    <form ref={formRef} action={formAction} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div className="flex flex-col gap-2">
        <Label htmlFor="name">{t("name")}</Label>
        <Input id="name" name="name" placeholder={t("namePlaceholder")} required />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="domain">{t("domain")}</Label>
        <Input id="domain" name="domain" placeholder={t("domainPlaceholder")} required />
      </div>
      <div className="flex flex-col gap-2 sm:col-span-2">
        <Label htmlFor="baseUrl">{t("baseUrl")}</Label>
        <Input
          id="baseUrl"
          name="baseUrl"
          type="url"
          placeholder={t("baseUrlPlaceholder")}
          required
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="sourceType">{t("sourceType")}</Label>
        <Select name="sourceType" defaultValue={searchSourceTypeValues[0]}>
          <SelectTrigger id="sourceType" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {searchSourceTypeValues.map((value) => (
              <SelectItem key={value} value={value}>
                {tSourceType(value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="processingType">{t("processingType")}</Label>
        <Select name="processingType" defaultValue="HTML">
          <SelectTrigger id="processingType" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {searchProcessingTypeValues.map((value) => (
              <SelectItem key={value} value={value}>
                {tProcessing(value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="priority">{t("priority")}</Label>
        <Input id="priority" name="priority" type="number" min={0} max={1000} defaultValue={50} />
        <p className="text-xs font-light text-muted-foreground">{t("priorityHint")}</p>
      </div>
      <div className="flex flex-col gap-2 sm:col-span-2">
        <Label htmlFor="notes">{t("notes")}</Label>
        <Textarea id="notes" name="notes" rows={2} placeholder={t("notesPlaceholder")} />
      </div>

      {state.error && (
        <p className="text-sm text-destructive sm:col-span-2">{t(`errors.${state.error}`)}</p>
      )}

      <Button
        type="submit"
        disabled={isPending}
        className="rounded-full sm:col-span-2 sm:w-fit"
      >
        {t("add")}
      </Button>
    </form>
  );
}
