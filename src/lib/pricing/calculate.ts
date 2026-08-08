export interface PricingRule {
  /** ISO date, inclusive. */
  startDate: string;
  /** ISO date, exclusive — matches the `daterange` convention used in the DB. */
  endDate: string;
  priceMinor: number;
  priority: number;
}

export interface NightPrice {
  date: string;
  priceMinor: number;
}

export interface BookingPriceBreakdown {
  nights: NightPrice[];
  nightsCount: number;
  totalMinor: number;
}

/** Highest-priority rule covering the night wins; ties resolve to the higher price. */
export function priceForNight(
  nightDate: string,
  basePriceMinor: number,
  rules: PricingRule[],
): number {
  const covering = rules.filter(
    (rule) => nightDate >= rule.startDate && nightDate < rule.endDate,
  );
  if (covering.length === 0) return basePriceMinor;

  return covering.reduce((best, rule) => {
    if (rule.priority > best.priority) return rule;
    if (rule.priority === best.priority && rule.priceMinor > best.priceMinor) return rule;
    return best;
  }, covering[0]).priceMinor;
}

/**
 * checkIn inclusive, checkOut exclusive (the night of checkOut itself is never charged).
 * Dates are plain "YYYY-MM-DD" strings advanced in UTC to stay immune to local DST shifts.
 */
export function calculateBookingPrice(
  checkIn: string,
  checkOut: string,
  basePriceMinor: number,
  rules: PricingRule[],
): BookingPriceBreakdown {
  const nights: NightPrice[] = [];
  const end = Date.parse(`${checkOut}T00:00:00Z`);
  let cursor = Date.parse(`${checkIn}T00:00:00Z`);

  while (cursor < end) {
    const date = new Date(cursor).toISOString().slice(0, 10);
    nights.push({ date, priceMinor: priceForNight(date, basePriceMinor, rules) });
    cursor += 24 * 60 * 60 * 1000;
  }

  return {
    nights,
    nightsCount: nights.length,
    totalMinor: nights.reduce((sum, night) => sum + night.priceMinor, 0),
  };
}
