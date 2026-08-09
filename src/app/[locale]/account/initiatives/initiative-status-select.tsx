"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/routing";
import { useRouter } from "@/i18n/navigation";
import { updateInitiativeStatus } from "@/server/actions/initiatives";
import { initiativeStatusValues } from "@/lib/validation/initiative";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type InitiativeStatus = (typeof initiativeStatusValues)[number];

export function InitiativeStatusSelect({
  initiativeId,
  status,
}: {
  initiativeId: string;
  status: InitiativeStatus;
}) {
  const t = useTranslations("initiativesPage");
  const tAccount = useTranslations("account.initiatives");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleChange(value: string) {
    startTransition(async () => {
      const result = await updateInitiativeStatus(locale, initiativeId, value as InitiativeStatus);
      if (result.error) {
        toast.error(tAccount("updateError"));
        return;
      }
      toast.success(tAccount("updated"));
      router.refresh();
    });
  }

  return (
    <Select value={status} onValueChange={handleChange} disabled={isPending}>
      <SelectTrigger className="w-32" size="sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {initiativeStatusValues.map((value) => (
          <SelectItem key={value} value={value}>
            {t(`status.${value}`)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
