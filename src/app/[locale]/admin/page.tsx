import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { getAdminOverview } from "@/server/queries/admin";
import { formatPrice } from "@/lib/pricing/format";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { buildTitle } from "@/lib/site";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "admin.overview" });
  return { title: buildTitle(t("title")) };
}

export default async function AdminOverviewPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  const t = await getTranslations("admin.overview");
  const tStatus = await getTranslations("booking.status");

  const overview = await getAdminOverview(locale);
  const currencies = [
    ...new Set([
      ...Object.keys(overview.revenueByCurrency),
      ...Object.keys(overview.averagePriceByCurrency),
    ]),
  ];

  return (
    <div>
      <h1 className="text-xl font-medium tracking-tight">{t("title")}</h1>
      <p className="mt-1 text-sm font-light text-muted-foreground">{t("subtitle")}</p>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label={t("totalBookings")} value={String(overview.totalBookings)} />
        <StatTile
          label={t("cancellationRate")}
          value={`${(overview.cancellationRate * 100).toFixed(1)}%`}
        />
        {currencies.map((currency) => (
          <StatTile
            key={`revenue-${currency}`}
            label={`${t("revenue")} · ${currency}`}
            value={formatPrice(overview.revenueByCurrency[currency] ?? 0, currency, locale)}
          />
        ))}
        {currencies.map((currency) => (
          <StatTile
            key={`avg-${currency}`}
            label={`${t("averagePrice")} · ${currency}`}
            value={formatPrice(overview.averagePriceByCurrency[currency] ?? 0, currency, locale)}
          />
        ))}
      </div>

      <div className="mt-6 rounded-2xl border border-border bg-card p-6 shadow-soft">
        <h2 className="text-sm font-medium tracking-tight">{t("bookingsByStatus")}</h2>
        <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {Object.entries(overview.bookingsByStatus).map(([status, count]) => (
            <li key={status} className="rounded-xl bg-muted p-3">
              <p className="text-xs font-light text-muted-foreground">{tStatus(status)}</p>
              <p className="mt-1 text-lg font-light">{count}</p>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
          <div className="p-4">
            <h2 className="text-sm font-medium tracking-tight">{t("topDestinations")}</h2>
          </div>
          {overview.topDestinations.length === 0 ? (
            <p className="px-4 pb-6 text-sm font-light text-muted-foreground">{t("noData")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("columns.destination")}</TableHead>
                  <TableHead className="text-right">{t("columns.bookings")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {overview.topDestinations.map((destination) => (
                  <TableRow key={destination.locationId}>
                    <TableCell>{destination.label}</TableCell>
                    <TableCell className="text-right">{destination.bookingsCount}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
          <div className="p-4">
            <h2 className="text-sm font-medium tracking-tight">{t("topVessels")}</h2>
          </div>
          {overview.topVessels.length === 0 ? (
            <p className="px-4 pb-6 text-sm font-light text-muted-foreground">{t("noData")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("columns.vessel")}</TableHead>
                  <TableHead className="text-right">{t("columns.bookings")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {overview.topVessels.map((vessel) => (
                  <TableRow key={vessel.vesselId}>
                    <TableCell>{vessel.name}</TableCell>
                    <TableCell className="text-right">{vessel.bookingsCount}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-light">{value}</p>
    </div>
  );
}
