/**
 * Flat rate until commissions become admin-configurable data (CLAUDE.md §10 step 10 /
 * BRD admin "комиссии") — not wired to a reference table yet, so this stays a constant.
 */
export const PLATFORM_COMMISSION_RATE = 0.12;

export function calculatePlatformFee(amountMinor: number): number {
  return Math.round(amountMinor * PLATFORM_COMMISSION_RATE);
}
