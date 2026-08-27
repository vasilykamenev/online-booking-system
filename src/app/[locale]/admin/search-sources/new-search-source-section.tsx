"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { SearchSourceForm } from "./search-source-form";

/**
 * Collapsed by default — the create form has grown a full pre-registration report (reachability,
 * robots.txt, sitemap, structured data, a candidate-card preview with per-field extraction and image
 * checks, plus a manual single-URL check), which is a lot to show an admin who just wants to scan the
 * existing source list. Expands on demand via "Add source", same one-click collapse back once done.
 */
export function NewSearchSourceSection() {
  const t = useTranslations("admin.searchSources");
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button type="button" className="mt-6 rounded-full" onClick={() => setOpen(true)}>
        <Plus className="size-4" strokeWidth={1.5} aria-hidden="true" />
        {t("addNew")}
      </Button>
    );
  }

  return (
    <div className="mt-6 rounded-2xl border border-border bg-card p-5 shadow-soft">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-medium">{t("addNew")}</h2>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="rounded-full"
          onClick={() => setOpen(false)}
        >
          <X className="size-4" strokeWidth={1.5} aria-hidden="true" />
          {t("collapseForm")}
        </Button>
      </div>
      <SearchSourceForm />
    </div>
  );
}
