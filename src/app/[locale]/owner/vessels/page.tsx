import type { Metadata } from "next";
import Image from "next/image";
import { Plus, Calendar, Tag } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { Link } from "@/i18n/navigation";
import { requireProfile } from "@/server/queries/profile";
import { getOwnerVessels } from "@/server/queries/owner";
import { formatPrice } from "@/lib/pricing/format";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { VesselStatusSelect } from "./vessel-status-select";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "owner.vessels" });
  return { title: `${t("title")} — Meridian` };
}

export default async function OwnerVesselsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  const t = await getTranslations("owner.vessels");
  const tTypes = await getTranslations("vessels.types");

  const profile = await requireProfile(locale);
  const vessels = await getOwnerVessels(profile.id);

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-medium tracking-tight">{t("title")}</h1>
          <p className="mt-1 text-sm font-light text-muted-foreground">{t("subtitle")}</p>
        </div>
        <Button asChild size="lg" className="rounded-full">
          <Link href="/owner/vessels/new">
            <Plus className="size-4" strokeWidth={1.5} />
            {t("add")}
          </Link>
        </Button>
      </div>

      {vessels.length === 0 ? (
        <p className="mt-10 rounded-2xl border border-dashed border-border p-10 text-center text-sm font-light text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <div className="mt-6 overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.vessel")}</TableHead>
                <TableHead>{t("columns.price")}</TableHead>
                <TableHead>{t("columns.guests")}</TableHead>
                <TableHead>{t("columns.status")}</TableHead>
                <TableHead className="text-right">{t("columns.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {vessels.map((vessel) => (
                <TableRow key={vessel.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="relative size-12 shrink-0 overflow-hidden rounded-lg bg-muted">
                        {vessel.imageUrl && (
                          <Image
                            src={vessel.imageUrl}
                            alt={vessel.name}
                            fill
                            sizes="48px"
                            className="object-cover"
                          />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{vessel.name}</p>
                        <p className="text-xs font-light text-muted-foreground">
                          {tTypes(vessel.type)}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>{formatPrice(vessel.basePriceMinor, vessel.currency, locale)}</TableCell>
                  <TableCell>{vessel.guestsCapacity}</TableCell>
                  <TableCell>
                    <VesselStatusSelect vesselId={vessel.id} status={vessel.status} />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button asChild variant="ghost" size="icon" aria-label={t("actions.pricing")}>
                        <Link href={`/owner/vessels/${vessel.id}/pricing`}>
                          <Tag className="size-4" strokeWidth={1.5} />
                        </Link>
                      </Button>
                      <Button asChild variant="ghost" size="icon" aria-label={t("actions.calendar")}>
                        <Link href={`/owner/vessels/${vessel.id}/calendar`}>
                          <Calendar className="size-4" strokeWidth={1.5} />
                        </Link>
                      </Button>
                      <Button asChild variant="outline" size="sm" className="rounded-full">
                        <Link href={`/owner/vessels/${vessel.id}/edit`}>{t("actions.edit")}</Link>
                      </Button>
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
