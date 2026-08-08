"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/routing";
import { useRouter } from "@/i18n/navigation";
import { updateVesselStatus } from "@/server/actions/vessels";
import { vesselStatusValues } from "@/lib/validation/vessel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type VesselStatus = (typeof vesselStatusValues)[number];

export function VesselStatusSelect({
  vesselId,
  status,
}: {
  vesselId: string;
  status: VesselStatus;
}) {
  const t = useTranslations("owner.vessels.status");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleChange(value: string) {
    startTransition(async () => {
      const result = await updateVesselStatus(locale, vesselId, value as VesselStatus);
      if (result.error) {
        toast.error(t("updateError"));
        return;
      }
      toast.success(t("updated"));
      router.refresh();
    });
  }

  return (
    <Select value={status} onValueChange={handleChange} disabled={isPending}>
      <SelectTrigger className="w-36" size="sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {vesselStatusValues.map((value) => (
          <SelectItem key={value} value={value}>
            {t(value)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
