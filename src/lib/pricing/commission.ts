/** Fallback used only if `platform_settings` has no row yet (should never happen after seed/migration). */
export const DEFAULT_PLATFORM_COMMISSION_RATE = 0.12;

export function calculatePlatformFee(
  amountMinor: number,
  rate: number = DEFAULT_PLATFORM_COMMISSION_RATE,
): number {
  return Math.round(amountMinor * rate);
}
