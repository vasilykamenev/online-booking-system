import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { Link } from "@/i18n/navigation";
import {
  getAllSearchSourcesAdmin,
  getSearchSourceHealthMap,
  getReindexConcurrency,
  getReindexMaxDurationSeconds,
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
import { NewSearchSourceSection } from "./new-search-source-section";
import { IndexingSettingsForm } from "./indexing-settings-form";
import { ReindexProgressIndicator } from "./reindex-progress-indicator";
import { SearchSourceToggleButton } from "./search-source-toggle-button";
import { SearchSourceStatusActions } from "./search-source-status-actions";
import { SearchSourceDeleteButton } from "./search-source-delete-button";

type SearchSourceStatus = Database["public"]["Enums"]["search_source_status"];
type SearchCircuitState = Database["public"]["Enums"]["search_circuit_state"];

const STATUS_BADGE_VARIANT: Record<
  SearchSourceStatus,
  "outline" | "secondary" | "default" | "destructive"
> = {
  draft: "outline",
  needs_review: "secondary",
  active: "default",
  rejected: "destructive",
};

/** Э8: CLOSED needs no visual alarm at all (the normal, healthy state) — shown as plain text, not a
 *  badge, so a healthy source list doesn't drown in green noise the way every other column's badges
 *  already avoid for their own "nothing wrong" state. */
const HEALTH_BADGE_VARIANT: Record<Exclude<SearchCircuitState, "CLOSED">, "secondary" | "destructive"> = {
  HALF_OPEN: "secondary",
  OPEN: "destructive",
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "admin.searchSources" });
  return { title: buildTitle(t("title")) };
}

export default async function AdminSearchSourcesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  const t = await getTranslations("admin.searchSources");
  const tProcessing = await getTranslations("admin.searchSources.processingType");
  const tLifecycle = await getTranslations("admin.searchSources.lifecycle");

  const [sources, health, reindexConcurrency, reindexMaxDurationSeconds] = await Promise.all([
    getAllSearchSourcesAdmin(),
    getSearchSourceHealthMap(),
    getReindexConcurrency(),
    getReindexMaxDurationSeconds(),
  ]);

  return (
    <div>
      <h1 className="text-xl font-medium tracking-tight">{t("title")}</h1>
      <p className="mt-1 text-sm font-light text-muted-foreground">{t("subtitle")}</p>
      <p className="mt-1 text-xs font-light text-muted-foreground">{t("wiringHint")}</p>
      <p className="mt-3 text-xs font-light text-muted-foreground">{t("indexingSettings.hint")}</p>
      <div className="mt-2">
        <IndexingSettingsForm
          currentConcurrency={reindexConcurrency}
          currentMaxDurationSeconds={reindexMaxDurationSeconds}
        />
      </div>

      <NewSearchSourceSection />

      {sources.length === 0 ? (
        <p className="mt-6 rounded-2xl border border-dashed border-border p-10 text-center text-sm font-light text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <div className="mt-6 overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.source")}</TableHead>
                <TableHead>{t("columns.processing")}</TableHead>
                <TableHead>{t("columns.priority")}</TableHead>
                <TableHead>{t("columns.robots")}</TableHead>
                <TableHead>{t("columns.health")}</TableHead>
                <TableHead>{t("columns.structure")}</TableHead>
                <TableHead>{t("columns.status")}</TableHead>
                <TableHead className="text-right">{t("columns.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sources.map((source) => (
                <TableRow key={source.id}>
                  <TableCell>
                    <div className="font-medium">{source.name}</div>
                    <a
                      href={source.baseUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-light text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground"
                    >
                      {source.domain}
                    </a>
                    <div>
                      <ReindexProgressIndicator sourceId={source.id} variant="compact" />
                    </div>
                  </TableCell>
                  <TableCell className="text-sm font-light text-muted-foreground">
                    {tProcessing(source.processingType)}
                  </TableCell>
                  <TableCell className="text-sm font-light text-muted-foreground">
                    {source.priority}
                  </TableCell>
                  <TableCell>
                    {source.robotsAllows === null ? (
                      <Badge variant="outline">{t("robots.unknown")}</Badge>
                    ) : source.robotsAllows ? (
                      <Badge variant="secondary">{t("robots.allowed")}</Badge>
                    ) : (
                      <Badge variant="destructive">{t("robots.disallowed")}</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {(() => {
                      const sourceHealth = health[source.id];
                      if (!sourceHealth || sourceHealth.state === "CLOSED") {
                        return <span className="text-xs font-light text-muted-foreground">{t("health.closed")}</span>;
                      }
                      return (
                        <Badge
                          variant={HEALTH_BADGE_VARIANT[sourceHealth.state]}
                          title={sourceHealth.lastError ?? undefined}
                        >
                          {t(`health.${sourceHealth.state.toLowerCase()}`, { count: sourceHealth.consecutiveFailures })}
                        </Badge>
                      );
                    })()}
                  </TableCell>
                  <TableCell>
                    {/* Э10: distinct from the health column above — a source can answer every fetch
                        with 200 (CLOSED breaker) while its pages have stopped yielding usable fields
                        at all, which is exactly what this badge is for. */}
                    {source.needsReanalysis ? (
                      <Badge
                        variant="destructive"
                        title={
                          source.reanalysisSampleSize !== null && source.reanalysisSuccessCount !== null
                            ? t("structure.detailTitle", {
                                success: source.reanalysisSuccessCount,
                                total: source.reanalysisSampleSize,
                              })
                            : undefined
                        }
                      >
                        {t("structure.needsReanalysis")}
                      </Badge>
                    ) : (
                      <span className="text-xs font-light text-muted-foreground">
                        {source.structureCheckedAt ? t("structure.ok") : t("structure.notChecked")}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      <Badge variant={STATUS_BADGE_VARIANT[source.status]}>
                        {tLifecycle(`badge.${source.status}`)}
                      </Badge>
                      {source.status === "active" && (
                        <Badge variant={source.enabled ? "default" : "outline"}>
                          {source.enabled ? t("statusEnabled") : t("statusDisabled")}
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button asChild variant="outline" size="sm" className="rounded-full">
                        <Link href={`/admin/search-sources/${source.id}/edit`}>{t("edit")}</Link>
                      </Button>
                      <Button asChild variant="outline" size="sm" className="rounded-full">
                        <Link href={`/admin/search-sources/${source.id}/urls`}>{t("urlRegistryLink")}</Link>
                      </Button>
                      {source.status === "active" ? (
                        <SearchSourceToggleButton sourceId={source.id} enabled={source.enabled} />
                      ) : (
                        <SearchSourceStatusActions sourceId={source.id} status={source.status} />
                      )}
                      <SearchSourceDeleteButton sourceId={source.id} />
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
