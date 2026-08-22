import type { Metadata } from "next";
import { X } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { Link } from "@/i18n/navigation";
import { buildTitle } from "@/lib/site";
import { criteriaToChips, isEmptyCriteria, MINOR_UNITS_PER_MAJOR } from "@/lib/search/criteria";
import { formatPrice } from "@/lib/pricing/format";
import { runGlobalVesselSearch } from "@/server/search/global-search-service";
import { buildSearchVocabulary } from "@/server/queries/search-vocabulary";
import { getActiveExternalProviders } from "@/server/search/provider-registry";
import { DiscoverForm } from "./discover-form";
import { GlobalResultCard } from "./result-card";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "discover" });
  return { title: buildTitle(t("title")), description: t("subtitle") };
}

/** `searchParams` values arrive as `string | string[] | undefined`; `remove` is intentionally repeatable. */
function toArray(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

export default async function DiscoverPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("discover");
  const tChips = await getTranslations("discover.chips");
  const tTypes = await getTranslations("vessels.types");

  const resolved = await searchParams;
  const rawQuery = toArray(resolved.q)[0] ?? "";
  const query = rawQuery.slice(0, 500).trim();
  const removed = toArray(resolved.remove);

  const response = query
    ? await runGlobalVesselSearch(query, {
        locale: locale as Locale,
        removedCriteria: removed,
        // Which sites get consulted is data-driven (`search_sources.enabled`), not a fixed list —
        // see `provider-registry.ts`. Disabling a source in /admin/search-sources takes it out of
        // search immediately, with no code change.
        externalProviders: await getActiveExternalProviders(),
        // Generous relative to the internal search's own budget: external sources fetch over the
        // real network, city-filtered but still several page loads. BRD §8's ≤1s applies to
        // internal search; external is the acknowledged exception (see README's two-phase note).
        externalTimeoutMs: 15_000,
      })
    : null;

  const chips = response ? criteriaToChips(response.interpretedCriteria) : [];

  /** Preserves the query and every other dismissal while adding one more. */
  const removeHref = (path: string) => {
    const next = new URLSearchParams();
    next.set("q", query);
    for (const value of [...removed, path]) next.append("remove", value);
    return `/discover?${next.toString()}`;
  };

  // Place criteria are stored canonically (one language's label) so that matching is stable across
  // query languages — which makes the stored value the wrong thing to display. Resolved back to
  // the reader's locale here, in the presentation layer, leaving the criteria themselves canonical.
  // `buildSearchVocabulary` is request-cached, so this reuses the lookup the search already did.
  const vocabulary = response ? await buildSearchVocabulary() : null;
  const placeLabel = (labelKey: string, value: string) => {
    const entries =
      labelKey === "country"
        ? vocabulary?.countries
        : labelKey === "city"
          ? vocabulary?.cities
          : labelKey === "marina"
            ? vocabulary?.marinas
            : undefined;
    return entries?.find((entry) => entry.value === value)?.labels?.[locale] ?? value;
  };

  const chipValue = (chip: (typeof chips)[number]) => {
    const { labelKey, value } = chip;
    if (labelKey === "vesselType") return tTypes(String(value));
    if (labelKey === "country" || labelKey === "city" || labelKey === "marina") {
      return placeLabel(labelKey, String(value));
    }
    if (labelKey === "priceMax") {
      const currency = response?.interpretedCriteria.price?.currency;
      // No invented currency symbol. The interpreter can extract an amount without identifying a
      // currency ("бюджет 5000"), and defaulting to USD would show "$5 000" to someone who meant
      // euros — a wrong fact stated confidently, which is worse than an unadorned number.
      return currency
        ? formatPrice(Number(value), currency, locale)
        : new Intl.NumberFormat(locale).format(Number(value) / MINOR_UNITS_PER_MAJOR);
    }
    if (labelKey === "month") {
      return new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(
        new Date(Date.UTC(2001, Number(value) - 1, 15)),
      );
    }
    // The unit is part of the value, not decoration: "2" means something different per unit.
    if (labelKey === "duration") {
      return tChips("durationValue", { value: Number(value), unit: chip.unit ?? "" });
    }
    return String(value);
  };

  return (
    <div className="pt-24 lg:pt-28">
      <section className="container-page pb-8">
        <span className="uppercase-label mb-3 block">{t("eyebrow")}</span>
        <h1 className="text-3xl font-light tracking-tight text-balance md:text-4xl">{t("title")}</h1>
        <p className="mt-3 max-w-2xl text-sm font-light leading-relaxed text-muted-foreground">
          {t("subtitle")}
        </p>

        <div className="mt-8 max-w-3xl">
          <DiscoverForm initialQuery={query} />
        </div>

        {response && (
          <div className="mt-6 max-w-3xl">
            {chips.length > 0 ? (
              <>
                <p className="uppercase-label mb-2">{t("understoodAs")}</p>
                <ul className="flex flex-wrap gap-2">
                  {chips.map((chip) => (
                    <li key={chip.path}>
                      {/* A chip is a link, not a control: removing a criterion is a new URL, which
                          keeps the whole refined search shareable and server-rendered. */}
                      <Link
                        href={removeHref(chip.path)}
                        className="group flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-light transition-colors hover:border-destructive/40 hover:text-destructive"
                        aria-label={t("removeCriterion", {
                          criterion: `${tChips(chip.labelKey)}: ${chipValue(chip)}`,
                        })}
                      >
                        <span className="text-muted-foreground group-hover:text-destructive">
                          {tChips(chip.labelKey)}
                        </span>
                        <span className="font-normal">{chipValue(chip)}</span>
                        <X className="size-3 opacity-50 group-hover:opacity-100" strokeWidth={1.5} />
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-sm font-light text-muted-foreground">{t("nothingUnderstood")}</p>
            )}

            {response.meta.interpretationDegraded && (
              <p className="mt-3 text-xs font-light text-muted-foreground">{t("degraded")}</p>
            )}
          </div>
        )}
      </section>

      {response && (
        <section className="container-page pb-24">
          <div className="mb-6 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-light tracking-tight">
              {t("resultsCount", { count: response.results.length })}
            </h2>
            <p className="text-xs font-light text-muted-foreground">
              {t("meta", {
                internal: response.meta.internalResults,
                external: response.meta.externalResults,
                ms: response.meta.searchDurationMs,
              })}
            </p>
          </div>

          {response.results.length === 0 ? (
            <p className="rounded-2xl border border-border bg-card p-8 text-center text-sm font-light text-muted-foreground">
              {isEmptyCriteria(response.interpretedCriteria) ? t("emptyCriteria") : t("noResults")}
            </p>
          ) : (
            <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {response.results.map((result, index) => (
                <li key={result.id}>
                  <GlobalResultCard result={result} index={index} />
                </li>
              ))}
            </ul>
          )}

          {response.meta.externalPhase === "SKIPPED" && (
            <p className="mt-6 text-xs font-light text-muted-foreground">{t("externalSkipped")}</p>
          )}
        </section>
      )}
    </div>
  );
}
