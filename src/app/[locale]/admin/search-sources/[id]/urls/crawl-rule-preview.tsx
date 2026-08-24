"use client";

import { useState, useTransition } from "react";
import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { previewSourceCrawlRules, type CrawlRulePreviewState } from "@/server/actions/admin";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CLASSIFICATION_BADGE_VARIANT } from "./classification-badge";
import { CreateRulesFromRobotsButton } from "./create-rules-from-robots-button";

/**
 * Live "what would happen" check for the crawl-rules page: fetches robots.txt and does a full
 * sitemap walk against the real site, classifying every URL with the source's currently saved
 * rules — read-only, nothing persisted. Not run automatically on page load (it's a real network
 * crawl, same cost as "Resync now"): an admin opts in with the button below.
 */
export function CrawlRulePreview({ sourceId }: { sourceId: string }) {
  const t = useTranslations("admin.searchSources.crawlRules");
  const tClassification = useTranslations("admin.searchSources.classification");
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<CrawlRulePreviewState | null>(null);

  function handleClick() {
    startTransition(async () => {
      setResult(await previewSourceCrawlRules(sourceId));
    });
  }

  const disallowCount = result?.robots?.rules.filter((rule) => !rule.allow).length ?? 0;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-medium tracking-tight">{t("preview.title")}</h2>
          <p className="mt-1 text-xs font-light text-muted-foreground">{t("preview.hint")}</p>
        </div>
        <Button variant="outline" size="sm" className="rounded-full" disabled={isPending} onClick={handleClick}>
          <Search className="size-4" strokeWidth={1.5} />
          {isPending ? t("preview.loading") : t("preview.run")}
        </Button>
      </div>

      {result?.error && (
        <p className="mt-4 text-sm text-destructive">{t(`preview.errors.${result.error}`)}</p>
      )}

      {result?.robots && (
        <div className="mt-4 rounded-2xl border border-border bg-card p-5 shadow-soft">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-medium">{t("robots.title")}</h3>
            {disallowCount > 0 && <CreateRulesFromRobotsButton sourceId={sourceId} />}
          </div>
          {!result.robots.found ? (
            <p className="mt-2 text-sm font-light text-muted-foreground">{t("robots.notFound")}</p>
          ) : result.robots.rules.length === 0 ? (
            <p className="mt-2 text-sm font-light text-muted-foreground">{t("robots.empty")}</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-1">
              {result.robots.rules.map((rule, index) => (
                <li key={`${rule.path}-${index}`} className="flex items-center gap-2 text-xs">
                  <Badge variant={rule.allow ? "secondary" : "destructive"}>
                    {rule.allow ? t("robots.allow") : t("robots.disallow")}
                  </Badge>
                  <span className="font-mono text-muted-foreground">{rule.path}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {result?.urls && (
        <div className="mt-4">
          <p className="text-xs font-light text-muted-foreground">
            {t("preview.countLine", {
              shown: result.urls.entries.length,
              total: result.urls.totalDiscovered,
            })}
            {result.urls.truncated && ` — ${t("preview.truncated")}`}
          </p>
          {result.urls.entries.length === 0 ? (
            <p className="mt-2 rounded-2xl border border-dashed border-border p-6 text-center text-sm font-light text-muted-foreground">
              {t("preview.empty")}
            </p>
          ) : (
            <div className="mt-2 max-h-96 overflow-y-auto overflow-x-auto rounded-2xl border border-border bg-card shadow-soft">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("preview.columns.url")}</TableHead>
                    <TableHead>{t("classification")}</TableHead>
                    <TableHead>{t("priority")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.urls.entries.map((entry) => (
                    <TableRow key={entry.url}>
                      <TableCell className="max-w-md truncate font-mono text-xs" title={entry.url}>
                        {entry.url}
                      </TableCell>
                      <TableCell>
                        <Badge variant={CLASSIFICATION_BADGE_VARIANT[entry.classification]}>
                          {tClassification(entry.classification)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm font-light text-muted-foreground">{entry.priority}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
