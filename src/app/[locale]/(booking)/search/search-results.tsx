"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import type { FeaturedVessel, SearchFilters } from "@/server/queries/vessels";
import { loadMoreVessels } from "@/server/actions/vessels";
import { Button } from "@/components/ui/button";
import { VesselCard } from "@/components/vessels/vessel-card";

export function SearchResults({
  initialVessels,
  initialCursor,
  filters,
}: {
  initialVessels: FeaturedVessel[];
  initialCursor: string | null;
  filters: Omit<SearchFilters, "cursor">;
}) {
  const t = useTranslations("search");
  const [vessels, setVessels] = useState(initialVessels);
  const [cursor, setCursor] = useState(initialCursor);
  const [isPending, startTransition] = useTransition();

  function handleLoadMore() {
    startTransition(async () => {
      const result = await loadMoreVessels({ ...filters, cursor: cursor ?? undefined });
      setVessels((prev) => [...prev, ...result.vessels]);
      setCursor(result.nextCursor);
    });
  }

  if (vessels.length === 0) {
    return (
      <p className="py-16 text-center text-sm font-light text-muted-foreground">
        {t("empty")}
      </p>
    );
  }

  return (
    <div>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {vessels.map((vessel, index) => (
          <VesselCard key={vessel.id} vessel={vessel} index={index % 4} />
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
