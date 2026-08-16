import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { Link } from "@/i18n/navigation";
import { getAllPaymentsAdmin } from "@/server/queries/admin";
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
import { buildTitle } from "@/lib/site";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "admin.payments" });
  return { title: buildTitle(t("title")) };
}

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive"> = {
  pending: "secondary",
  succeeded: "default",
  failed: "destructive",
  cancelled: "destructive",
  refunded: "secondary",
};

export default async function AdminPaymentsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  const t = await getTranslations("admin.payments");

  const payments = await getAllPaymentsAdmin();
  const dateFormatter = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });

  return (
    <div>
      <h1 className="text-xl font-medium tracking-tight">{t("title")}</h1>
      <p className="mt-1 text-sm font-light text-muted-foreground">{t("subtitle")}</p>

      {payments.length === 0 ? (
        <p className="mt-10 rounded-2xl border border-dashed border-border p-10 text-center text-sm font-light text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <div className="mt-6 overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.date")}</TableHead>
                <TableHead>{t("columns.booking")}</TableHead>
                <TableHead>{t("columns.payer")}</TableHead>
                <TableHead>{t("columns.payee")}</TableHead>
                <TableHead>{t("columns.provider")}</TableHead>
                <TableHead>{t("columns.amount")}</TableHead>
                <TableHead>{t("columns.fee")}</TableHead>
                <TableHead>{t("columns.status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payments.map((payment) => (
                <TableRow key={payment.id}>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {dateFormatter.format(new Date(payment.createdAt))}
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/booking/${payment.bookingId}`}
                      className="text-sm font-medium hover:text-primary"
                    >
                      {payment.vesselName}
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm">{payment.payerName ?? t("unknown")}</TableCell>
                  <TableCell className="text-sm">{payment.payeeName ?? t("unknown")}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {t(`provider.${payment.provider}`)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {formatPrice(payment.amountMinor, payment.currency, locale)}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatPrice(payment.platformFeeMinor, payment.currency, locale)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[payment.status] ?? "secondary"}>
                      {t(`status.${payment.status}`)}
                    </Badge>
                    {payment.failureReason && (
                      <span className="mt-1 block max-w-56 text-xs text-destructive">
                        {payment.failureReason}
                      </span>
                    )}
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
