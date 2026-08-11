import type { Metadata } from "next";
import { Plus, MessageSquare } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { Link } from "@/i18n/navigation";
import { requireProfile } from "@/server/queries/profile";
import { getMyInitiatives } from "@/server/queries/initiatives";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { InitiativeStatusSelect } from "./initiative-status-select";
import { InitiativeDeleteButton } from "./initiative-delete-button";
import { buildTitle } from "@/lib/site";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "account.initiatives" });
  return { title: buildTitle(t("title")) };
}

export default async function AccountInitiativesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  const t = await getTranslations("account.initiatives");

  const profile = await requireProfile(locale);
  const initiatives = await getMyInitiatives(profile.id);

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-medium tracking-tight">{t("title")}</h1>
          <p className="mt-1 text-sm font-light text-muted-foreground">{t("subtitle")}</p>
        </div>
        <Button asChild size="lg" className="rounded-full">
          <Link href="/initiatives/new">
            <Plus className="size-4" strokeWidth={1.5} />
            {t("add")}
          </Link>
        </Button>
      </div>

      {initiatives.length === 0 ? (
        <p className="mt-10 rounded-2xl border border-dashed border-border p-10 text-center text-sm font-light text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <div className="mt-6 overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.title")}</TableHead>
                <TableHead>{t("columns.responses")}</TableHead>
                <TableHead>{t("columns.status")}</TableHead>
                <TableHead className="text-right">{t("columns.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {initiatives.map((initiative) => (
                <TableRow key={initiative.id}>
                  <TableCell>
                    <Link
                      href={`/initiatives/${initiative.id}`}
                      className="text-sm font-medium hover:text-primary"
                    >
                      {initiative.title}
                    </Link>
                    <p className="text-xs font-light text-muted-foreground">
                      {initiative.topic} · {initiative.region}
                    </p>
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-1.5 text-sm font-light">
                      <MessageSquare className="size-3.5" strokeWidth={1.5} />
                      {initiative.responseCount}
                    </span>
                  </TableCell>
                  <TableCell>
                    <InitiativeStatusSelect
                      initiativeId={initiative.id}
                      status={initiative.status}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <InitiativeDeleteButton initiativeId={initiative.id} />
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
