import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { Link } from "@/i18n/navigation";
import { requireProfile } from "@/server/queries/profile";
import { getBookingById } from "@/server/queries/bookings";
import { formatPrice } from "@/lib/pricing/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "booking.confirmation" });
  return { title: `${t("eyebrow")} — Meridian` };
}

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive"> = {
  pending: "secondary",
  confirmed: "default",
  paid: "default",
  cancelled: "destructive",
  completed: "secondary",
};

export default async function BookingConfirmationPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = (await params) as { locale: Locale; id: string };
  setRequestLocale(locale);
  await requireProfile(locale);

  const booking = await getBookingById(id);
  if (!booking) notFound();

  const t = await getTranslations("booking.confirmation");
  const tStatus = await getTranslations("booking.status");
  const dateFormatter = new Intl.DateTimeFormat(locale, { dateStyle: "long" });

  return (
    <div className="container-page flex min-h-[70vh] items-center justify-center py-24 lg:py-28">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-soft md:p-8">
        <span className="uppercase-label">{t("eyebrow")}</span>

        <div className="mt-4 flex gap-4">
          <div className="relative size-20 shrink-0 overflow-hidden rounded-xl bg-muted">
            {booking.vesselImageUrl && (
              <Image
                src={booking.vesselImageUrl}
                alt={booking.vesselName}
                fill
                sizes="80px"
                className="object-cover"
              />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <Link
                href={`/vessels/${booking.vesselSlug}`}
                className="truncate text-base font-medium tracking-tight hover:text-primary"
              >
                {booking.vesselName}
              </Link>
              <Badge variant={STATUS_VARIANT[booking.status] ?? "secondary"} className="shrink-0">
                {tStatus(booking.status)}
              </Badge>
            </div>
            <p className="mt-1 text-sm font-light text-muted-foreground">
              {dateFormatter.format(new Date(booking.dateRange.start))} —{" "}
              {dateFormatter.format(new Date(booking.dateRange.end))}
            </p>
            <p className="mt-1 text-sm font-light text-muted-foreground">
              {booking.guestsCount} {t("guests")}
            </p>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-between border-t border-border pt-6">
          <span className="text-sm font-light text-muted-foreground">{t("createdOn")}</span>
          <span className="text-sm font-light">
            {dateFormatter.format(new Date(booking.createdAt))}
          </span>
        </div>
        <div className="mt-2 flex items-center justify-between">
          <span className="text-sm font-medium">{t("total")}</span>
          <span className="text-lg font-light">
            {formatPrice(booking.priceMinor, booking.currency, locale)}
          </span>
        </div>

        <p className="mt-6 rounded-xl bg-muted px-4 py-3 text-sm font-light text-muted-foreground">
          {t("pending")}
        </p>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <Button asChild variant="outline" className="flex-1 rounded-full">
            <Link href={`/vessels/${booking.vesselSlug}`}>{t("backToVessel")}</Link>
          </Button>
          <Button asChild className="flex-1 rounded-full">
            <Link href="/account/bookings">{t("toBookings")}</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
