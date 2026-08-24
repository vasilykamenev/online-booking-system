"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/routing";
import { useRouter } from "@/i18n/navigation";
import { setUrlSelectionOverride } from "@/server/actions/admin";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type OverrideChoice = "auto" | "include" | "exclude";

function toChoice(override: boolean | null): OverrideChoice {
  if (override === true) return "include";
  if (override === false) return "exclude";
  return "auto";
}

function toOverride(choice: OverrideChoice): boolean | null {
  if (choice === "include") return true;
  if (choice === "exclude") return false;
  return null;
}

export function UrlSelectionToggle({
  sourceId,
  urlRowId,
  selectionOverride,
}: {
  sourceId: string;
  urlRowId: string;
  selectionOverride: boolean | null;
}) {
  const t = useTranslations("admin.searchSources.urlRegistry.selection");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleChange(value: string) {
    startTransition(async () => {
      const result = await setUrlSelectionOverride(
        locale,
        sourceId,
        urlRowId,
        toOverride(value as OverrideChoice),
      );
      if (result.error) {
        toast.error(t("error"));
        return;
      }
      router.refresh();
    });
  }

  return (
    <Select defaultValue={toChoice(selectionOverride)} onValueChange={handleChange} disabled={isPending}>
      <SelectTrigger className="h-8 w-32 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="auto">{t("auto")}</SelectItem>
        <SelectItem value="include">{t("include")}</SelectItem>
        <SelectItem value="exclude">{t("exclude")}</SelectItem>
      </SelectContent>
    </Select>
  );
}
