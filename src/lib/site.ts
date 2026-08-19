export const SITE_NAME = process.env.NEXT_PUBLIC_SITE_NAME ?? "Meridian Beyond";

export function buildTitle(title: string): string {
  return `${title} — ${SITE_NAME}`;
}
