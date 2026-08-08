/** Half-open date interval [start, end) — matches the `daterange` convention used in the DB. */
export interface DateInterval {
  start: string;
  end: string;
}

export function rangesOverlap(a: DateInterval, b: DateInterval): boolean {
  return a.start < b.end && b.start < a.end;
}

export function isRangeAvailable(candidate: DateInterval, unavailable: DateInterval[]): boolean {
  return !unavailable.some((range) => rangesOverlap(candidate, range));
}
