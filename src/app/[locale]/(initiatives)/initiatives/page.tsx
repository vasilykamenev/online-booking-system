import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { parseInitiativeFilters } from "@/lib/validation/initiative";
import { getInitiativeFacets, searchInitiatives } from "@/server/queries/initiatives";
import { getCurrentProfile } from "@/server/queries/profile";
import { getFavoriteInitiativeIds } from "@/server/queries/account";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { InitiativeFiltersForm } from "./initiative-filters";
import { InitiativeResults } from "./initiative-results";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "initiativesPage" });

  return {
    title: `${t("title")} — Meridian`,
    description: t("subtitle"),
  };
}

export default async function InitiativesFeedPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("initiativesPage");

  const filters = parseInitiativeFilters(await searchParams);
  const queryFilters = {
    topic: filters.topic,
    region: filters.region,
    activityType: filters.activityType,
    status: filters.status,
  };

  const [facets, result, profile] = await Promise.all([
    getInitiativeFacets(),
    searchInitiatives(queryFilters),
    getCurrentProfile(),
  ]);
  const favoritedIds = profile ? await getFavoriteInitiativeIds(profile.id) : new Set<string>();

  return (
    <div className="pt-24 lg:pt-28">
      <section className="container-page pb-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="uppercase-label mb-3 block">{t("eyebrow")}</span>
            <h1 className="text-3xl font-light tracking-tight text-balance md:text-4xl">
              {t("title")}
            </h1>
            <p className="mt-3 max-w-xl text-sm font-light leading-relaxed text-muted-foreground">
              {t("subtitle")}
            </p>
          </div>
          <Button asChild size="lg" className="rounded-full">
            <Link href="/initiatives/new">
              <Plus className="size-4" strokeWidth={1.5} />
              {t("publish")}
            </Link>
          </Button>
        </div>

        <div className="mt-8">
          <InitiativeFiltersForm facets={facets} defaultValues={filters} />
        </div>
      </section>

      <section className="container-page pb-24">
        <InitiativeResults
          key={JSON.stringify(queryFilters)}
          initialInitiatives={result.initiatives}
          initialCursor={result.nextCursor}
          filters={queryFilters}
          favoritedIds={favoritedIds}
        />
      </section>
    </div>
  );
}
