import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { getAuditLog } from "@/server/queries/admin";
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
  const t = await getTranslations({ locale, namespace: "admin.auditLog" });
  return { title: `${t("title")} — Meridian` };
}

export default async function AdminAuditLogPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  const t = await getTranslations("admin.auditLog");

  const entries = await getAuditLog();
  const dateFormatter = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });

  return (
    <div>
      <h1 className="text-xl font-medium tracking-tight">{t("title")}</h1>
      <p className="mt-1 text-sm font-light text-muted-foreground">{t("subtitle")}</p>

      {entries.length === 0 ? (
        <p className="mt-10 rounded-2xl border border-dashed border-border p-10 text-center text-sm font-light text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <div className="mt-6 overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.date")}</TableHead>
                <TableHead>{t("columns.admin")}</TableHead>
                <TableHead>{t("columns.action")}</TableHead>
                <TableHead>{t("columns.target")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {dateFormatter.format(new Date(entry.createdAt))}
                  </TableCell>
                  <TableCell className="text-sm">{entry.adminName ?? t("unknownAdmin")}</TableCell>
                  <TableCell className="font-mono text-xs">{entry.action}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {entry.targetTable}
                    {entry.targetId ? ` · ${entry.targetId.slice(0, 8)}` : ""}
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
