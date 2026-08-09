"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import type { InitiativeCard as InitiativeCardData, InitiativeFilters } from "@/server/queries/initiatives";
import { loadMoreInitiatives } from "@/server/actions/initiatives";
import { Button } from "@/components/ui/button";
import { InitiativeCard } from "@/components/initiatives/initiative-card";

export function InitiativeResults({
  initialInitiatives,
  initialCursor,
  filters,
  favoritedIds,
}: {
  initialInitiatives: InitiativeCardData[];
  initialCursor: string | null;
  filters: Omit<InitiativeFilters, "cursor">;
  favoritedIds: Set<string>;
}) {
  const t = useTranslations("initiativesPage");
  const [initiatives, setInitiatives] = useState(initialInitiatives);
  const [cursor, setCursor] = useState(initialCursor);
  const [isPending, startTransition] = useTransition();

  function handleLoadMore() {
    startTransition(async () => {
      const result = await loadMoreInitiatives({ ...filters, cursor: cursor ?? undefined });
      setInitiatives((prev) => [...prev, ...result.initiatives]);
      setCursor(result.nextCursor);
    });
  }

  if (initiatives.length === 0) {
    return (
      <p className="py-16 text-center text-sm font-light text-muted-foreground">{t("empty")}</p>
    );
  }

  return (
    <div>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {initiatives.map((initiative, index) => (
          <InitiativeCard
            key={initiative.id}
            initiative={initiative}
            index={index % 3}
            isFavorited={favoritedIds.has(initiative.id)}
          />
        ))}
      </div>

      {cursor && (
        <div className="mt-12 flex justify-center">
          <Button
            variant="outline"
            size="lg"
            className="rounded-full"
            onClick={handleLoadMore}
            disabled={isPending}
          >
            {isPending ? t("loading") : t("loadMore")}
          </Button>
        </div>
      )}
    </div>
  );
}
