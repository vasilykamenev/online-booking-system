import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { parseSearchParams } from "@/lib/validation/search";
import { getSearchLocations, searchVessels } from "@/server/queries/vessels";
import { getCurrentProfile } from "@/server/queries/profile";
import { getFavoriteVesselIds } from "@/server/queries/account";
import { SearchFiltersForm } from "./search-filters";
import { SearchResults } from "./search-results";
import { buildTitle } from "@/lib/site";

/**
 * Deliberately no `loading.tsx` in this route segment, despite CLAUDE.md §7's normal rule — same
 * finding as `(booking)/discover/page.tsx`'s own note: Next's automatic route-level `<Suspense>`
 * wrap never completes client-side hydration once SSR takes more than a couple of seconds (a real
 * catalog search does), leaving the whole page — including `SearchFiltersForm`'s inputs and
 * `AdvancedFiltersSheet` — permanently unclickable despite rendering correct HTML. Removing the file
 * restored full interactivity. Revisit once the underlying Next.js/React/Turbopack issue is fixed.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "search" });

  return {
    title: buildTitle(t("title")),
    description: t("subtitle"),
  };
}

export default async function SearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("search");

  const filters = parseSearchParams(await searchParams);
  const queryFilters = {
    type: filters.type,
    locationId: filters.location,
    guests: filters.guests,
    priceMinMinor: filters.priceMin ? filters.priceMin * 100 : undefined,
    priceMaxMinor: filters.priceMax ? filters.priceMax * 100 : undefined,
    lengthMin: filters.lengthMin,
    lengthMax: filters.lengthMax,
    cabinsMin: filters.cabinsMin,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    sort: filters.sort,
  };

  const [locations, result, profile] = await Promise.all([
    getSearchLocations(),
    searchVessels(queryFilters),
    getCurrentProfile(),
  ]);
  const favoritedVesselIds = profile ? await getFavoriteVesselIds(profile.id) : new Set<string>();

  return (
    <div className="pt-24 lg:pt-28">
      <section className="container-page pb-8">
        <span className="uppercase-label mb-3 block">{t("eyebrow")}</span>
        <h1 className="text-3xl font-light tracking-tight text-balance md:text-4xl">
          {t("title")}
        </h1>
        <p className="mt-3 max-w-xl text-sm font-light leading-relaxed text-muted-foreground">
          {t("subtitle")}
        </p>

        <div className="mt-8">
          {/* Keyed on the applied filters so the form remounts (and its react-hook-form/date-picker
              state resets) whenever the URL changes from outside itself — a filter-chip removal or
              the sort control, neither of which this form's own state otherwise hears about. */}
          <SearchFiltersForm key={JSON.stringify(filters)} locations={locations} defaultValues={filters} />
        </div>
      </section>

      <section className="container-page pb-24">
        <SearchResults
          key={JSON.stringify(queryFilters)}
          initialVessels={result.vessels}
          initialCursor={result.nextCursor}
          filters={queryFilters}
          urlFilters={filters}
          favoritedVesselIds={favoritedVesselIds}
        />
      </section>
    </div>
  );
}
