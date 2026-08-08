/** Postgres daterange text form is "[2026-08-01,2026-08-07)" — bounds are always present for our ranges. */
export function parseDateRangeLiteral(raw: string): { start: string; end: string } {
  const [start, end] = raw.replace(/[[\])]/g, "").split(",");
  return { start, end };
}

/** Inverse of parseDateRangeLiteral — start inclusive, end exclusive, matching the `daterange` columns. */
export function toDateRangeLiteral(start: string, end: string): string {
  return `[${start},${end})`;
}
