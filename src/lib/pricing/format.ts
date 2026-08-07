/** Money is stored in minor units (cents); this is the only place it becomes a float, for display only. */
export function formatPrice(amountMinor: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amountMinor / 100);
}
