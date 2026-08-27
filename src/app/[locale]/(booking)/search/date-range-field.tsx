"use client";

import { useMemo, useState, type ComponentProps } from "react";
import { format, isSameDay, parseISO, startOfDay } from "date-fns";
import { ru, enUS } from "date-fns/locale";
import type { DateRange, Matcher } from "react-day-picker";
import { CalendarIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/routing";
import { Calendar, CalendarDayButton } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

const DATE_FNS_LOCALES = { ru, en: enUS } satisfies Record<Locale, typeof ru>;

/** Same range-tint treatment as `BookingWidget`'s calendar (`components/booking/booking-widget.tsx`)
 *  — kept as its own small component here rather than shared, since that one also wires in
 *  `unavailableRanges` disabling that this field has no use for (search happens before there's a
 *  single vessel to check availability against). */
function RangeDayButton({ className, ...props }: ComponentProps<typeof CalendarDayButton>) {
  return (
    <CalendarDayButton
      {...props}
      className={cn(
        className,
        "data-[range-middle=true]:bg-primary/15 data-[range-middle=true]:text-foreground data-[selected-single=true]:bg-primary",
      )}
    />
  );
}

/**
 * Both ends or neither — there's no "apply" state in between. `onChange` only ever fires with two
 * defined dates or two `undefined`s, matching `searchParamsSchema`'s "a lone end is inert" rule
 * (`lib/validation/search.ts`), so the parent form never has to guard against a half-set range.
 */
export function DateRangeField({
  dateFrom,
  dateTo,
  onChange,
}: {
  dateFrom?: string;
  dateTo?: string;
  onChange: (dateFrom: string | undefined, dateTo: string | undefined) => void;
}) {
  const t = useTranslations("search.filters");
  const locale = useLocale() as Locale;
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<Date | undefined>(dateFrom ? parseISO(dateFrom) : undefined);
  const [explicitEnd, setExplicitEnd] = useState<Date | undefined>(dateTo ? parseISO(dateTo) : undefined);

  const range = useMemo<DateRange | undefined>(() => {
    if (!anchor) return undefined;
    if (!explicitEnd) return { from: anchor, to: undefined };
    const [from, to] = anchor <= explicitEnd ? [anchor, explicitEnd] : [explicitEnd, anchor];
    return { from, to };
  }, [anchor, explicitEnd]);

  function handleSelect(_range: DateRange | undefined, clickedDay: Date) {
    if (!anchor || explicitEnd) {
      setAnchor(clickedDay);
      setExplicitEnd(undefined);
      return;
    }
    if (isSameDay(clickedDay, anchor)) return;
    setExplicitEnd(clickedDay);
  }

  function handleApply() {
    if (range?.from && range?.to) {
      onChange(format(range.from, "yyyy-MM-dd"), format(range.to, "yyyy-MM-dd"));
    }
    setOpen(false);
  }

  function handleClear() {
    setAnchor(undefined);
    setExplicitEnd(undefined);
    onChange(undefined, undefined);
    setOpen(false);
  }

  const label =
    dateFrom && dateTo
      ? `${format(parseISO(dateFrom), "d MMM", { locale: DATE_FNS_LOCALES[locale] })} – ${format(
          parseISO(dateTo),
          "d MMM",
          { locale: DATE_FNS_LOCALES[locale] },
        )}`
      : t("anyDates");

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button type="button" variant="outline" className="w-full justify-start gap-2 rounded-full font-normal">
          <CalendarIcon className="size-4" strokeWidth={1.5} />
          {label}
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-sm">
        <SheetHeader>
          <SheetTitle>{t("dates")}</SheetTitle>
        </SheetHeader>
        <div className="px-4">
          <Calendar
            mode="range"
            selected={range}
            onSelect={handleSelect}
            disabled={[{ before: startOfDay(new Date()) }] satisfies Matcher[]}
            locale={DATE_FNS_LOCALES[locale]}
            numberOfMonths={1}
            className="mx-auto"
            classNames={{
              range_start: "bg-primary/15 after:bg-primary/15",
              range_end: "bg-primary/15 after:bg-primary/15",
            }}
            components={{
              DayButton: (dayButtonProps) => (
                <RangeDayButton {...dayButtonProps} locale={DATE_FNS_LOCALES[locale]} />
              ),
            }}
          />
        </div>
        <SheetFooter className="flex-row justify-end gap-2">
          <Button type="button" variant="ghost" className="rounded-full" onClick={handleClear}>
            {t("clearDates")}
          </Button>
          <Button
            type="button"
            className="rounded-full"
            onClick={handleApply}
            disabled={!range?.from || !range?.to}
          >
            {t("applyDates")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
