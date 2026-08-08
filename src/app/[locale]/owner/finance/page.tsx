import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { requireProfile } from "@/server/queries/profile";
import { getOwnerFinanceSummary } from "@/server/queries/owner";
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

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "owner.finance" });
  return { title: `${t("title")} — Meridian` };
}

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive"> = {
  pending: "secondary",
  confirmed: "default",
  paid: "default",
  cancelled: "destructive",
  completed: "secondary",
};

export default async function OwnerFinancePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  const t = await getTranslations("owner.finance");
  const tStatus = await getTranslations("booking.status");

  const profile = await requireProfile(locale);
  const { byCurrency, bookings } = await getOwnerFinanceSummary(profile.id);
  const currencies = Object.keys(byCurrency);

  return (
    <div>
      <h1 className="text-xl font-medium tracking-tight">{t("title")}</h1>
      <p className="mt-1 text-sm font-light text-muted-foreground">{t("subtitle")}</p>

      {currencies.length === 0 ? (
        <p className="mt-10 rounded-2xl border border-dashed border-border p-10 text-center text-sm font-light text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <>
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {currencies.map((currency) => (
              <div key={currency} className="rounded-2xl border border-border bg-card p-6 shadow-soft">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">
                  {t("earned")} · {currency}
                </p>
                <p className="mt-2 text-2xl font-light">
                  {formatPrice(byCurrency[currency].earnedMinor, currency, locale)}
                </p>
                <p className="mt-4 text-xs uppercase tracking-wider text-muted-foreground">
                  {t("pending")}
                </p>
                <p className="mt-1 text-lg font-light text-muted-foreground">
                  {formatPrice(byCurrency[currency].pendingMinor, currency, locale)}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-6 overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("columns.vessel")}</TableHead>
                  <TableHead>{t("columns.date")}</TableHead>
                  <TableHead>{t("columns.status")}</TableHead>
                  <TableHead className="text-right">{t("columns.amount")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bookings.map((booking) => (
                  <TableRow key={booking.id}>
                    <TableCell>{booking.vesselName}</TableCell>
                    <TableCell>
                      {new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
                        new Date(booking.createdAt),
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[booking.status] ?? "secondary"}>
                        {tStatus(booking.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {formatPrice(booking.priceMinor, booking.currency, locale)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
