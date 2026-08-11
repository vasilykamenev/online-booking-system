import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { Link } from "@/i18n/navigation";
import { getAllLocationsAdmin } from "@/server/queries/admin";
import { pickLocalized } from "@/lib/supabase/localized";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LocationDeleteButton } from "./location-delete-button";
import { buildTitle } from "@/lib/site";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "admin.locations" });
  return { title: buildTitle(t("title")) };
}

export default async function AdminLocationsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  const t = await getTranslations("admin.locations");

  const locations = await getAllLocationsAdmin();

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-medium tracking-tight">{t("title")}</h1>
          <p className="mt-1 text-sm font-light text-muted-foreground">{t("subtitle")}</p>
        </div>
        <Button asChild size="lg" className="rounded-full">
          <Link href="/admin/locations/new">
            <Plus className="size-4" strokeWidth={1.5} />
            {t("add")}
          </Link>
        </Button>
      </div>

      {locations.length === 0 ? (
        <p className="mt-10 rounded-2xl border border-dashed border-border p-10 text-center text-sm font-light text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <div className="mt-6 overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.country")}</TableHead>
                <TableHead>{t("columns.city")}</TableHead>
                <TableHead>{t("columns.marina")}</TableHead>
                <TableHead className="text-right">{t("columns.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {locations.map((location) => (
                <TableRow key={location.id}>
                  <TableCell>{pickLocalized(location.country, locale)}</TableCell>
                  <TableCell>{pickLocalized(location.city, locale)}</TableCell>
                  <TableCell>
                    {location.marina ? pickLocalized(location.marina, locale) : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button asChild variant="outline" size="sm" className="rounded-full">
                        <Link href={`/admin/locations/${location.id}/edit`}>{t("edit")}</Link>
                      </Button>
                      <LocationDeleteButton locationId={location.id} />
                    </div>
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
