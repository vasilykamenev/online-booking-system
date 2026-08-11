import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { Link } from "@/i18n/navigation";
import { requireProfile } from "@/server/queries/profile";
import { getOwnerBookings } from "@/server/queries/owner";
import { formatPrice } from "@/lib/pricing/format";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BookingActions } from "./booking-actions";
import { buildTitle } from "@/lib/site";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "owner.bookings" });
  return { title: buildTitle(t("title")) };
}

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive"> = {
  pending: "secondary",
  confirmed: "default",
  paid: "default",
  cancelled: "destructive",
  completed: "secondary",
};

export default async function OwnerBookingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  const t = await getTranslations("owner.bookings");
  const tStatus = await getTranslations("booking.status");

  const profile = await requireProfile(locale);
  const bookings = await getOwnerBookings(profile.id);

  return (
    <div>
      <h1 className="text-xl font-medium tracking-tight">{t("title")}</h1>
      <p className="mt-1 text-sm font-light text-muted-foreground">{t("subtitle")}</p>

      {bookings.length === 0 ? (
        <p className="mt-10 rounded-2xl border border-dashed border-border p-10 text-center text-sm font-light text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <div className="mt-6 overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.vessel")}</TableHead>
                <TableHead>{t("columns.dates")}</TableHead>
                <TableHead>{t("columns.guests")}</TableHead>
                <TableHead>{t("columns.price")}</TableHead>
                <TableHead>{t("columns.status")}</TableHead>
                <TableHead>{t("columns.payment")}</TableHead>
                <TableHead className="text-right">{t("columns.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bookings.map((booking) => (
                <TableRow key={booking.id}>
                  <TableCell>
                    <Link
                      href={`/vessels/${booking.vesselSlug}`}
                      className="font-medium hover:text-primary"
                    >
                      {booking.vesselName}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
                      new Date(booking.dateRange.start),
                    )}{" "}
                    —{" "}
                    {new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
                      new Date(booking.dateRange.end),
                    )}
                  </TableCell>
                  <TableCell>{booking.guestsCount}</TableCell>
                  <TableCell>{formatPrice(booking.priceMinor, booking.currency, locale)}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[booking.status] ?? "secondary"}>
                      {tStatus(booking.status)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {booking.latestPayment ? (
                      <span className="text-sm font-light text-muted-foreground">
                        {t(`paymentProvider.${booking.latestPayment.provider}`)} ·{" "}
                        {t(`paymentStatus.${booking.latestPayment.status}`)}
                      </span>
                    ) : (
                      <span className="text-sm font-light text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <BookingActions
                      bookingId={booking.id}
                      status={booking.status}
                      latestPayment={booking.latestPayment}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
