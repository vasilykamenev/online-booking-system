"use client";

import { useMemo, useState, useTransition } from "react";
import { addDays, format, parseISO, startOfDay } from "date-fns";
import { ru, enUS } from "date-fns/locale";
import type { DateRange, Matcher } from "react-day-picker";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import type { Locale } from "@/i18n/routing";
import { useRouter } from "@/i18n/navigation";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatPrice } from "@/lib/pricing/format";
import { calculateBookingPrice, type PricingRule } from "@/lib/pricing/calculate";
import { createBooking } from "@/server/actions/bookings";
import type { DateInterval } from "@/lib/availability/ranges";

const DATE_FNS_LOCALES = { ru, en: enUS } satisfies Record<Locale, typeof ru>;

export function BookingWidget({
  vesselId,
  basePriceMinor,
  currency,
  guestsCapacity,
  pricingRules,
  unavailableRanges,
}: {
  vesselId: string;
  basePriceMinor: number;
  currency: string;
  guestsCapacity: number;
  pricingRules: PricingRule[];
  unavailableRanges: DateInterval[];
}) {
  const t = useTranslations("vesselPage.priceCard");
  const locale = useLocale() as Locale;
  const router = useRouter();

  const [range, setRange] = useState<DateRange | undefined>();
  const [guests, setGuests] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const disabledMatchers = useMemo<Matcher[]>(
    () => [
      { before: startOfDay(new Date()) },
      ...unavailableRanges.map((interval) => ({
        from: parseISO(interval.start),
        to: addDays(parseISO(interval.end), -1),
      })),
    ],
    [unavailableRanges],
  );

  const breakdown = useMemo(() => {
    if (!range?.from || !range?.to) return null;
    return calculateBookingPrice(
      format(range.from, "yyyy-MM-dd"),
      format(range.to, "yyyy-MM-dd"),
      basePriceMinor,
      pricingRules,
    );
  }, [range, basePriceMinor, pricingRules]);

  function handleSubmit() {
    if (!range?.from || !range?.to) {
      setError(t("selectDates"));
      return;
    }
    setError(null);
    const checkIn = format(range.from, "yyyy-MM-dd");
    const checkOut = format(range.to, "yyyy-MM-dd");

    startTransition(async () => {
      const result = await createBooking({
        vesselId,
        checkIn,
        checkOut,
        guestsCount: Number(guests),
      });

      if (result.error === "unauthenticated") {
        toast.error(t("signInRequired"));
        router.push("/auth/login");
        return;
      }
      if (result.error) {
        setError(t(`errors.${result.error}`));
        return;
      }
      router.push(`/booking/${result.bookingId}`);
    });
  }

  return (
    <div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-2xl font-light text-foreground">
          {formatPrice(basePriceMinor, currency, locale)}
        </span>
        <span className="text-sm font-light text-muted-foreground">{t("perNight")}</span>
      </div>
      <p className="mt-2 text-xs font-light text-muted-foreground">
        {t("guestsCapacity", { count: guestsCapacity })}
      </p>

      <div className="mt-5 border-t border-border pt-5">
        <Calendar
          mode="range"
          selected={range}
          onSelect={setRange}
          disabled={disabledMatchers}
          locale={DATE_FNS_LOCALES[locale]}
          numberOfMonths={1}
          className="mx-auto"
        />
      </div>

      <div className="mt-4 flex flex-col gap-2">
        <label className="text-xs uppercase tracking-wider text-muted-foreground">
          {t("guests")}
        </label>
        <Select value={guests} onValueChange={setGuests}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Array.from({ length: guestsCapacity }, (_, i) => i + 1).map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {breakdown && breakdown.nightsCount > 0 && (
        <div className="mt-4 space-y-1.5 border-t border-border pt-4 text-sm font-light">
          <div className="flex items-center justify-between text-muted-foreground">
            <span>{t("nightsCount", { count: breakdown.nightsCount })}</span>
          </div>
          <div className="flex items-center justify-between font-medium text-foreground">
            <span>{t("total")}</span>
            <span>{formatPrice(breakdown.totalMinor, currency, locale)}</span>
          </div>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

      <Button
        type="button"
        size="lg"
        disabled={isPending}
        onClick={handleSubmit}
        className="mt-5 w-full rounded-full"
      >
        {t("submit")}
      </Button>
    </div>
  );
}
