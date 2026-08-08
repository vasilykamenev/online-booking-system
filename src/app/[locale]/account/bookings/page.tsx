import type { Metadata } from "next";
import Image from "next/image";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { requireProfile } from "@/server/queries/profile";
import { getBookingHistory } from "@/server/queries/account";
import { formatPrice } from "@/lib/pricing/format";
import { Link } from "@/i18n/navigation";
import { Badge } from "@/components/ui/badge";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "account.bookings" });
  return { title: `${t("title")} — Meridian` };
}

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive"> = {
  pending: "secondary",
  confirmed: "default",
  paid: "default",
  cancelled: "destructive",
  completed: "secondary",
};

export default async function AccountBookingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  const t = await getTranslations("account.bookings");

  const profile = await requireProfile(locale);
  const bookings = await getBookingHistory(profile.id);

  return (
    <div>
      <h1 className="text-xl font-medium tracking-tight">{t("title")}</h1>
      <p className="mt-1 text-sm font-light text-muted-foreground">{t("subtitle")}</p>

      {bookings.length === 0 ? (
        <p className="mt-10 rounded-2xl border border-dashed border-border p-10 text-center text-sm font-light text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <ul className="mt-6 space-y-4">
          {bookings.map((booking) => (
            <li
              key={booking.id}
              className="flex gap-4 rounded-2xl border border-border bg-card p-4 shadow-soft"
            >
              <Link
                href={`/vessels/${booking.vesselSlug}`}
                className="relative size-20 shrink-0 overflow-hidden rounded-xl bg-muted"
              >
                {booking.vesselImageUrl && (
                  <Image
                    src={booking.vesselImageUrl}
                    alt={booking.vesselName}
                    fill
                    sizes="80px"
                    className="object-cover"
                  />
                )}
              </Link>

              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <Link
                    href={`/vessels/${booking.vesselSlug}`}
                    className="truncate text-sm font-medium tracking-tight hover:text-primary"
                  >
                    {booking.vesselName}
                  </Link>
                  <Badge variant={STATUS_VARIANT[booking.status] ?? "secondary"} className="shrink-0">
                    {t(`status.${booking.status}`)}
                  </Badge>
                </div>
                <p className="mt-1 text-xs font-light text-muted-foreground">
                  {new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
                    new Date(booking.dateRange.start),
                  )}{" "}
                  —{" "}
                  {new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
                    new Date(booking.dateRange.end),
                  )}
                  {" · "}
                  {booking.guestsCount} {t("guests")}
                </p>
                <p className="mt-2 text-sm font-light text-foreground">
                  {formatPrice(booking.priceMinor, booking.currency, locale)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
