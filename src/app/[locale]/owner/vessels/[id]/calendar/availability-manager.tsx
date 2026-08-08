"use client";

import { useActionState, useTransition } from "react";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/routing";
import { useRouter } from "@/i18n/navigation";
import {
  addAvailabilityBlock,
  removeAvailabilityBlock,
  type AvailabilityActionState,
} from "@/server/actions/availability";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AvailabilityBlock } from "@/server/queries/owner";

const initialState: AvailabilityActionState = {};

export function AvailabilityManager({
  vesselId,
  blocks,
}: {
  vesselId: string;
  blocks: AvailabilityBlock[];
}) {
  const t = useTranslations("owner.vessels.calendar");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const dateFormatter = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });

  const [state, formAction, isPending] = useActionState(
    addAvailabilityBlock.bind(null, locale, vesselId),
    initialState,
  );
  const [isRemoving, startRemoving] = useTransition();

  function handleRemove(blockId: string) {
    startRemoving(async () => {
      const result = await removeAvailabilityBlock(locale, vesselId, blockId);
      if (result.error) {
        toast.error(t("errors.generic"));
        return;
      }
      router.refresh();
    });
  }

  return (
    <div>
      {blocks.length > 0 && (
        <ul className="space-y-2">
          {blocks.map((block) => (
            <li
              key={block.id}
              className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm"
            >
              <div>
                <span>
                  {dateFormatter.format(new Date(block.dateRange.start))} —{" "}
                  {dateFormatter.format(new Date(block.dateRange.end))}
                </span>
                {block.reason && (
                  <span className="ml-2 font-light text-muted-foreground">{block.reason}</span>
                )}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={isRemoving}
                onClick={() => handleRemove(block.id)}
              >
                {t("remove")}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <form action={formAction} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="startDate">{t("startDate")}</Label>
          <Input id="startDate" name="startDate" type="date" required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="endDate">{t("endDate")}</Label>
          <Input id="endDate" name="endDate" type="date" required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="reason">{t("reason")}</Label>
          <Input id="reason" name="reason" />
        </div>
        {state.error && (
          <p className="text-sm text-destructive sm:col-span-3">{t(`errors.${state.error}`)}</p>
        )}
        <Button
          type="submit"
          variant="outline"
          size="sm"
          disabled={isPending}
          className="w-fit rounded-full sm:col-span-3"
        >
          {t("addBlock")}
        </Button>
      </form>
    </div>
  );
}
