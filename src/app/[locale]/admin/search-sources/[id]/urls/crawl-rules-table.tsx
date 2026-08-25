"use client";

import { useMemo, useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/routing";
import { useRouter } from "@/i18n/navigation";
import { deleteCrawlRules } from "@/server/actions/admin";
import type { AdminCrawlRule } from "@/server/queries/admin";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CrawlRuleDeleteButton } from "./crawl-rule-delete-button";
import { CLASSIFICATION_BADGE_VARIANT } from "./classification-badge";

/** Crawl-rules table with per-row and multi-select bulk delete. Selection lives in this client
 *  component's own state — the surrounding page stays a server component and just hands over the
 *  already-fetched rows. */
export function CrawlRulesTable({ sourceId, rules }: { sourceId: string; rules: AdminCrawlRule[] }) {
  const t = useTranslations("admin.searchSources.crawlRules");
  const tClassification = useTranslations("admin.searchSources.classification");
  const tPatternType = useTranslations("admin.searchSources.crawlRules.patternType");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const selectedIds = useMemo(() => [...selected].filter((id) => rules.some((rule) => rule.id === id)), [selected, rules]);
  const allSelected = rules.length > 0 && selectedIds.length === rules.length;

  function toggleOne(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleAll(checked: boolean) {
    setSelected(checked ? new Set(rules.map((rule) => rule.id)) : new Set());
  }

  function handleDeleteSelected() {
    if (!window.confirm(t("confirmDeleteSelected", { count: selectedIds.length }))) return;

    startTransition(async () => {
      const result = await deleteCrawlRules(locale, sourceId, selectedIds);
      if (result.error) {
        toast.error(t("deleteError"));
        return;
      }
      toast.success(t("deletedSelected", { count: selectedIds.length }));
      setSelected(new Set());
      router.refresh();
    });
  }

  return (
    <div>
      {selectedIds.length > 0 && (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-2xl border border-border bg-muted px-4 py-2.5">
          <p className="text-sm font-light text-muted-foreground">
            {t("selectedCount", { count: selectedIds.length })}
          </p>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            className="rounded-full"
            disabled={isPending}
            onClick={handleDeleteSelected}
          >
            <Trash2 className="size-4" strokeWidth={1.5} />
            {t("deleteSelected")}
          </Button>
        </div>
      )}
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  aria-label={t("selectAll")}
                  checked={allSelected}
                  onCheckedChange={(checked) => toggleAll(checked === true)}
                />
              </TableHead>
              <TableHead>{t("patternType.label")}</TableHead>
              <TableHead>{t("pattern")}</TableHead>
              <TableHead>{t("classification")}</TableHead>
              <TableHead>{t("priority")}</TableHead>
              <TableHead className="text-right">{t("actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rules.map((rule) => (
              <TableRow key={rule.id} data-state={selected.has(rule.id) ? "selected" : undefined}>
                <TableCell>
                  <Checkbox
                    aria-label={t("selectRow")}
                    checked={selected.has(rule.id)}
                    onCheckedChange={(checked) => toggleOne(rule.id, checked === true)}
                  />
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{tPatternType(rule.patternType)}</Badge>
                </TableCell>
                <TableCell className="font-mono text-xs">{rule.pattern}</TableCell>
                <TableCell>
                  <Badge variant={CLASSIFICATION_BADGE_VARIANT[rule.classification]}>
                    {tClassification(rule.classification)}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm font-light text-muted-foreground">{rule.priority}</TableCell>
                <TableCell className="text-right">
                  <CrawlRuleDeleteButton sourceId={sourceId} ruleId={rule.id} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
