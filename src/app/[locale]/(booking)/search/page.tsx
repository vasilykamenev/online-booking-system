import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { parseSearchParams } from "@/lib/validation/search";
import { getSearchLocations, searchVessels } from "@/server/queries/vessels";
import { getCurrentProfile } from "@/server/queries/profile";
import { getFavoriteVesselIds } from "@/server/queries/account";
import { SearchFiltersForm } from "./search-filters";
import { SearchResults } from "./search-results";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "search" });

  return {
    title: `${t("title")} — Meridian`,
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
    priceMaxMinor: filters.priceMax ? filters.priceMax * 100 : undefined,
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
          <SearchFiltersForm locations={locations} defaultValues={filters} />
        </div>
      </section>

      <section className="container-page pb-24">
        <SearchResults
          key={JSON.stringify(queryFilters)}
          initialVessels={result.vessels}
          initialCursor={result.nextCursor}
          filters={queryFilters}
          favoritedVesselIds={favoritedVesselIds}
        />
      </section>
    </div>
  );
}
