"use client";

import { useState, useTransition } from "react";
import { Search, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/**
 * The natural-language entry point (spec §20). Submitting navigates rather than mutating: the
 * query lives in the URL, so a global search is shareable, bookmarkable, back-button-friendly and
 * server-rendered — and dropping a criterion chip is just another link.
 */
export function DiscoverForm({ initialQuery }: { initialQuery: string }) {
  const t = useTranslations("discover");
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [isPending, startTransition] = useTransition();

  function submit() {
    const trimmed = query.trim();
    if (!trimmed) return;
    // Deliberately drops any `remove` params: a new query means new criteria, so previously
    // dismissed chips no longer refer to anything.
    startTransition(() => router.push(`/discover?q=${encodeURIComponent(trimmed)}`));
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="rounded-2xl border border-border bg-card p-4 shadow-soft md:p-5"
    >
      <label htmlFor="discover-query" className="sr-only">
        {t("placeholder")}
      </label>
      <Textarea
        id="discover-query"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          // Enter searches, Shift+Enter adds a line — the field is multi-line because real
          // requests run to a sentence or two, but it is still primarily a search box.
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
        }}
        rows={2}
        placeholder={t("placeholder")}
        className="resize-none border-0 bg-transparent text-base shadow-none focus-visible:ring-0"
      />
      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-xs font-light text-muted-foreground">{t("hint")}</p>
        <Button type="submit" size="lg" disabled={isPending || !query.trim()} className="rounded-full">
          {isPending ? (
            <Loader2 className="size-4 animate-spin" strokeWidth={1.5} />
          ) : (
            <Search className="size-4" strokeWidth={1.5} />
          )}
          {t("search")}
        </Button>
      </div>
    </form>
  );
}
