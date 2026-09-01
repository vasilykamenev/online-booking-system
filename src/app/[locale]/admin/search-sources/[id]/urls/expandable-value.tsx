"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

/**
 * Long free-text table values (crawl-rule patterns, field-conflict values) default to a single
 * truncated line — no auto-expansion, ever, so a long regex or a paragraph-length extracted
 * description never blows out a table row's height on its own. Expansion is opt-in only (click),
 * and once expanded shows a wrapped, multi-line box rather than just lifting the truncation on the
 * same single line — the two states are deliberately different shapes, not the same line grown wide.
 */
export function ExpandableValue({ value, className }: { value: string | null; className?: string }) {
  const t = useTranslations("admin.searchSources");
  const [expanded, setExpanded] = useState(false);

  if (!value) return null;

  if (expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(false)}
        aria-label={t("collapseValue")}
        className={cn(
          "block max-w-sm whitespace-pre-wrap break-words rounded-lg border border-border bg-muted p-2 text-left font-mono text-xs",
          className,
        )}
      >
        {value}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setExpanded(true)}
      aria-label={t("expandValue")}
      title={t("expandValue")}
      className={cn("block max-w-xs truncate text-left underline decoration-dotted underline-offset-2", className)}
    >
      {value}
    </button>
  );
}
