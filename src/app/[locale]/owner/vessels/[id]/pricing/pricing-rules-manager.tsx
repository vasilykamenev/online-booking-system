"use client";

import { useActionState, useTransition } from "react";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/routing";
import { useRouter } from "@/i18n/navigation";
import { createPricingRule, deletePricingRule, type PricingActionState } from "@/server/actions/pricing";
import { formatPrice } from "@/lib/pricing/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { OwnerPricingRule } from "@/server/queries/owner";

const initialState: PricingActionState = {};

export function PricingRulesManager({
  vesselId,
  currency,
  rules,
}: {
  vesselId: string;
  currency: string;
  rules: OwnerPricingRule[];
}) {
  const t = useTranslations("owner.vessels.pricing");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const dateFormatter = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });

  const [state, formAction, isPending] = useActionState(
    createPricingRule.bind(null, locale, vesselId),
    initialState,
  );
  const [isRemoving, startRemoving] = useTransition();

  function handleRemove(ruleId: string) {
    startRemoving(async () => {
      const result = await deletePricingRule(locale, vesselId, ruleId);
      if (result.error) {
        toast.error(t("errors.generic"));
        return;
      }
      router.refresh();
    });
  }

  return (
    <div>
      {rules.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.label")}</TableHead>
                <TableHead>{t("columns.dates")}</TableHead>
                <TableHead>{t("columns.price")}</TableHead>
                <TableHead>{t("columns.priority")}</TableHead>
                <TableHead className="text-right">{t("columns.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules.map((rule) => (
                <TableRow key={rule.id}>
                  <TableCell>{rule.label}</TableCell>
                  <TableCell>
                    {dateFormatter.format(new Date(rule.startDate))} —{" "}
                    {dateFormatter.format(new Date(rule.endDate))}
                  </TableCell>
                  <TableCell>{formatPrice(rule.priceMinor, currency, locale)}</TableCell>
                  <TableCell>{rule.priority}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={isRemoving}
                      onClick={() => handleRemove(rule.id)}
                    >
                      {t("remove")}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <form action={formAction} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-5">
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="label">{t("label")}</Label>
          <Input id="label" name="label" required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="startDate">{t("startDate")}</Label>
          <Input id="startDate" name="startDate" type="date" required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="endDate">{t("endDate")}</Label>
          <Input id="endDate" name="endDate" type="date" required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="price">{t("price")}</Label>
          <Input id="price" name="price" type="number" step="0.01" min="0" required />
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="priority">{t("priority")}</Label>
          <Input id="priority" name="priority" type="number" min="0" defaultValue={0} required />
        </div>
        {state.error && (
          <p className="text-sm text-destructive sm:col-span-5">{t(`errors.${state.error}`)}</p>
        )}
        <Button
          type="submit"
          variant="outline"
          size="sm"
          disabled={isPending}
          className="w-fit rounded-full sm:col-span-5"
        >
          {t("addRule")}
        </Button>
      </form>
    </div>
  );
}
