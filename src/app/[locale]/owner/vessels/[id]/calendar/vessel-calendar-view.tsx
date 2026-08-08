"use client";

import { addDays, parseISO } from "date-fns";
import { ru, enUS } from "date-fns/locale";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/routing";
import { Calendar } from "@/components/ui/calendar";
import type { DateInterval } from "@/lib/availability/ranges";

const DATE_FNS_LOCALES = { ru, en: enUS } satisfies Record<Locale, typeof ru>;

export function VesselCalendarView({
  bookedRanges,
  blockedRanges,
}: {
  bookedRanges: DateInterval[];
  blockedRanges: DateInterval[];
}) {
  const t = useTranslations("owner.vessels.calendar");
  const locale = useLocale() as Locale;

  const toDayRange = (interval: DateInterval) => ({
    from: parseISO(interval.start),
    to: addDays(parseISO(interval.end), -1),
  });

  return (
    <div>
      <Calendar
        mode="multiple"
        selected={[]}
        onSelect={() => {}}
        numberOfMonths={2}
        locale={DATE_FNS_LOCALES[locale]}
        className="mx-auto"
        modifiers={{
          booked: bookedRanges.map(toDayRange),
          blocked: blockedRanges.map(toDayRange),
        }}
        modifiersClassNames={{
          booked: "bg-destructive/15 text-destructive",
          blocked: "bg-muted-foreground/15 text-muted-foreground line-through",
        }}
      />
      <div className="mt-4 flex items-center justify-center gap-6 text-xs font-light text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-destructive/40" />
          {t("legendBooked")}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-muted-foreground/40" />
          {t("legendBlocked")}
        </span>
      </div>
    </div>
  );
}
