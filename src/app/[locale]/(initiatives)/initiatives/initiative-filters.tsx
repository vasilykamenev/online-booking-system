"use client";

import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import {
  initiativeFiltersSchema,
  initiativeStatusValues,
  type InitiativeFilters,
} from "@/lib/validation/initiative";
import type { InitiativeFacets } from "@/server/queries/initiatives";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ANY = "any";

export function InitiativeFiltersForm({
  facets,
  defaultValues,
}: {
  facets: InitiativeFacets;
  defaultValues: InitiativeFilters;
}) {
  const t = useTranslations("initiativesPage");
  const router = useRouter();

  const form = useForm<InitiativeFilters>({
    resolver: zodResolver(initiativeFiltersSchema),
    defaultValues,
  });
  const topicValue = useWatch({ control: form.control, name: "topic" });
  const regionValue = useWatch({ control: form.control, name: "region" });
  const activityTypeValue = useWatch({ control: form.control, name: "activityType" });
  const statusValue = useWatch({ control: form.control, name: "status" });

  function onSubmit(values: InitiativeFilters) {
    const params = new URLSearchParams();
    if (values.topic) params.set("topic", values.topic);
    if (values.region) params.set("region", values.region);
    if (values.activityType) params.set("activityType", values.activityType);
    if (values.status) params.set("status", values.status);
    router.push(params.size > 0 ? `/initiatives?${params.toString()}` : "/initiatives");
  }

  return (
    <form
      onSubmit={form.handleSubmit(onSubmit)}
      className="grid grid-cols-1 gap-4 rounded-2xl border border-border bg-card p-5 shadow-soft sm:grid-cols-2 lg:grid-cols-5 lg:items-end"
    >
      <div className="flex flex-col gap-2">
        <Label>{t("filters.topic")}</Label>
        <Select
          value={topicValue ?? ANY}
          onValueChange={(value) => form.setValue("topic", value === ANY ? undefined : value)}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder={t("filters.anyTopic")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>{t("filters.anyTopic")}</SelectItem>
            {facets.topics.map((topic) => (
              <SelectItem key={topic} value={topic}>
                {topic}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-2">
        <Label>{t("filters.region")}</Label>
        <Select
          value={regionValue ?? ANY}
          onValueChange={(value) => form.setValue("region", value === ANY ? undefined : value)}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder={t("filters.anyRegion")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>{t("filters.anyRegion")}</SelectItem>
            {facets.regions.map((region) => (
              <SelectItem key={region} value={region}>
                {region}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-2">
        <Label>{t("filters.activityType")}</Label>
        <Select
          value={activityTypeValue ?? ANY}
          onValueChange={(value) =>
            form.setValue("activityType", value === ANY ? undefined : value)
          }
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder={t("filters.anyActivityType")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>{t("filters.anyActivityType")}</SelectItem>
            {facets.activityTypes.map((activityType) => (
              <SelectItem key={activityType} value={activityType}>
                {activityType}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-2">
        <Label>{t("filters.status")}</Label>
        <Select
          value={statusValue ?? ANY}
          onValueChange={(value) =>
            form.setValue(
              "status",
              value === ANY ? undefined : (value as InitiativeFilters["status"]),
            )
          }
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder={t("filters.anyStatus")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>{t("filters.anyStatus")}</SelectItem>
            {initiativeStatusValues.map((status) => (
              <SelectItem key={status} value={status}>
                {t(`status.${status}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Button type="submit" size="lg" className="rounded-full">
        {t("filters.apply")}
      </Button>
    </form>
  );
}
