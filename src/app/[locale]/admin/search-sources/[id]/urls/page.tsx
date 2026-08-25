import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { Link } from "@/i18n/navigation";
import {
  getSearchSourceById,
  getSourceUrlCounts,
  getCrawlRules,
  getSourceUrlRegistry,
} from "@/server/queries/admin";
import { buildTitle } from "@/lib/site";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Database } from "@/lib/supabase/database.types";
import { ResyncUrlsButton } from "./resync-urls-button";
import { ClearUrlsButton } from "./clear-urls-button";
import { CrawlRuleForm } from "./crawl-rule-form";
import { CrawlRulesTable } from "./crawl-rules-table";
import { AddManualUrlsForm } from "./add-manual-urls-form";
import { UrlSelectionToggle } from "./url-selection-toggle";
import { CrawlRulePreview } from "./crawl-rule-preview";
import { CLASSIFICATION_BADGE_VARIANT } from "./classification-badge";

type UrlClassification = Database["public"]["Enums"]["search_url_classification"];

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "admin.searchSources.urlRegistry" });
  return { title: buildTitle(t("title")) };
}

export default async function SearchSourceUrlsPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = (await params) as { locale: Locale; id: string };
  setRequestLocale(locale);
  const t = await getTranslations("admin.searchSources.urlRegistry");
  const tClassification = await getTranslations("admin.searchSources.classification");
  const tCrawlStatus = await getTranslations("admin.searchSources.urlRegistry.crawlStatus");
  const tRules = await getTranslations("admin.searchSources.crawlRules");
  const tManualAdd = await getTranslations("admin.searchSources.urlRegistry.manualAdd");

  const source = await getSearchSourceById(id);
  if (!source) notFound();

  const [counts, rules, rows] = await Promise.all([
    getSourceUrlCounts(id),
    getCrawlRules(id),
    getSourceUrlRegistry(id),
  ]);
  const classifications: UrlClassification[] = ["HIGH", "MEDIUM", "LOW", "SKIP"];
  const total = classifications.reduce((sum, key) => sum + counts[key].total, 0);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-medium tracking-tight">{t("title")}</h1>
          <p className="mt-1 text-sm font-light text-muted-foreground">
            {source.name} — {source.domain}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm" className="rounded-full">
            <Link href={`/admin/search-sources/${id}/edit`}>{t("backToEdit")}</Link>
          </Button>
          <ResyncUrlsButton sourceId={id} />
        </div>
      </div>

      {total === 0 ? (
        <p className="mt-6 rounded-2xl border border-dashed border-border p-10 text-center text-sm font-light text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <div className="mt-6 flex flex-wrap gap-3">
          {classifications.map((key) => (
            <div key={key} className="rounded-2xl border border-border bg-card px-4 py-2 shadow-soft">
              <Badge variant={CLASSIFICATION_BADGE_VARIANT[key]}>{tClassification(key)}</Badge>
              <p className="mt-1 text-sm font-light text-muted-foreground">
                {t("countsLine", { selected: counts[key].selected, total: counts[key].total })}
              </p>
            </div>
          ))}
        </div>
      )}

      <div className="mt-8">
        <h2 className="text-base font-medium tracking-tight">{tRules("title")}</h2>
        <p className="mt-1 text-xs font-light text-muted-foreground">{tRules("hint")}</p>
        <div className="mt-4 rounded-2xl border border-border bg-card p-5 shadow-soft">
          <CrawlRuleForm sourceId={id} />
        </div>
        {rules.length > 0 && (
          <div className="mt-4">
            <CrawlRulesTable sourceId={id} rules={rules} />
          </div>
        )}
      </div>

      <div className="mt-8">
        <CrawlRulePreview sourceId={id} />
      </div>

      <div className="mt-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-medium tracking-tight">{t("urlsTitle")}</h2>
            <p className="mt-1 text-xs font-light text-muted-foreground">{t("urlsHint")}</p>
          </div>
          {total > 0 && <ClearUrlsButton sourceId={id} />}
        </div>

        <div className="mt-4 rounded-2xl border border-border bg-card p-5 shadow-soft">
          <h3 className="text-sm font-medium">{tManualAdd("title")}</h3>
          <div className="mt-3">
            <AddManualUrlsForm sourceId={id} />
          </div>
        </div>

        {rows.length === 0 ? (
          <p className="mt-4 rounded-2xl border border-dashed border-border p-10 text-center text-sm font-light text-muted-foreground">
            {t("empty")}
          </p>
        ) : (
          <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("columns.url")}</TableHead>
                  <TableHead>{t("columns.classification")}</TableHead>
                  <TableHead>{t("columns.crawlStatus")}</TableHead>
                  <TableHead>{t("columns.selection")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="max-w-md truncate font-mono text-xs" title={row.url}>
                      {row.url}
                    </TableCell>
                    <TableCell>
                      <Badge variant={CLASSIFICATION_BADGE_VARIANT[row.classification]}>
                        {tClassification(row.classification)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm font-light text-muted-foreground">
                      {tCrawlStatus(row.crawlStatus)}
                    </TableCell>
                    <TableCell>
                      <UrlSelectionToggle
                        sourceId={id}
                        urlRowId={row.id}
                        selectionOverride={row.selectionOverride}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
