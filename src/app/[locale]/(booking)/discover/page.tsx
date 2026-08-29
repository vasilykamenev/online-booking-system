import type { Metadata } from "next";
import { X } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { Link } from "@/i18n/navigation";
import { buildTitle } from "@/lib/site";
import { criteriaToChips, isEmptyCriteria, MINOR_UNITS_PER_MAJOR } from "@/lib/search/request";
import { formatPrice } from "@/lib/pricing/format";
import {
  runInternalSearchPhase,
  runExternalSearchPhase,
  type InternalSearchPhaseResult,
} from "@/server/search/orchestrator/search-orchestrator";
import { buildSearchVocabulary } from "@/server/queries/search-vocabulary";
import { DiscoverForm } from "./discover-form";
import { GlobalResultCard } from "./result-card";

/**
 * Deliberately no `loading.tsx` in this route segment, despite CLAUDE.md §7's normal rule — Next's
 * automatic route-level `<Suspense>` wrap (which a `loading.tsx` file creates) was found to never
 * complete client-side hydration for this exact request once server rendering takes more than a
 * couple of seconds, which a real discover search always does. Confirmed via direct fiber-tree
 * inspection (the boundary's host node had no `child` fiber, live in both `next dev` and a
 * production build) and by removing the file, which restored full interactivity. Fast route
 * segments (`/`, `/account`) keep their own `loading.tsx` fine — this looks tied to slow SSR, not
 * `loading.tsx` itself, but the safe fix today is not having one here. Revisit once the underlying
 * Next.js/React/Turbopack issue is understood or a newer version fixes it — see the same note on
 * `ExternalResultsSection` below, and the analogous note in `(booking)/search/page.tsx`.
 */

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

/**
 * Awaited directly as part of the page's own render pass — **not** wrapped in `<Suspense>`.
 * It used to be (Э6): internal results rendered immediately, this section streamed in once
 * `runExternalSearchPhase` resolved. That streaming split is temporarily disabled: this exact
 * `<Suspense>` boundary (and separately, the route segment's own `loading.tsx` boundary) was found
 * to never complete client-side hydration in this project's Next.js 16.3.0 / React 19.2.8 /
 * Turbopack combination — the boundary's SSR content displayed correctly but stayed permanently
 * non-interactive (confirmed via direct fiber-tree inspection: the boundary's host node had no
 * `child` fiber, live in both dev and a production build; pages with no Suspense boundary at all,
 * e.g. `/vessels/[slug]`, hydrated normally). Reverting to a single blocking await trades away the
 * BRD §8 fast-internal-results perception for a working, clickable page — revisit once the
 * underlying framework issue is understood/fixed upstream. Still reads its own translations rather
 * than receiving them as a prop, since `getTranslations` is request-scoped/cached and this was kept
 * as its own function for a minimal diff back to streaming later.
 */
async function ExternalResultsSection({ internalPhase }: { internalPhase: InternalSearchPhaseResult }) {
  const t = await getTranslations("discover");
  const { externalOnlyResults, meta } = await runExternalSearchPhase(internalPhase);

  const nothingFoundAnywhere = internalPhase.internalResults.length === 0 && externalOnlyResults.length === 0;

  return (
    <>
      {/* Paired the same way the single-list header used to be (count on the left, "Свои/Внешние/мс"
          on the right) — just attached to this section now, since the combined count and total
          duration aren't known until the external phase itself resolves. */}
      <div className="mb-6 mt-10 flex flex-wrap items-baseline justify-between gap-2">
        {externalOnlyResults.length > 0 && (
          <h2 className="text-lg font-light tracking-tight">
            {t("externalResultsCount", { count: externalOnlyResults.length })}
          </h2>
        )}
        <p className="text-xs font-light text-muted-foreground">
          {t("meta", { internal: meta.internalResults, external: meta.externalResults, ms: meta.searchDurationMs })}
        </p>
      </div>

      {externalOnlyResults.length > 0 && (
        <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {externalOnlyResults.map((result, index) => (
            <li key={result.id}>
              <GlobalResultCard result={result} index={index} />
            </li>
          ))}
        </ul>
      )}

      {nothingFoundAnywhere && (
        <p className="mt-6 rounded-2xl border border-border bg-card p-8 text-center text-sm font-light text-muted-foreground">
          {isEmptyCriteria(internalPhase.interpretedCriteria) ? t("emptyCriteria") : t("noResults")}
        </p>
      )}

      {/* Э6: the external phase always runs to completion once called (a source-registry read
          failure or zero covering sources degrades to `externalResults: 0`, not a separate
          "skipped" state any more — see `source-registry.ts`'s own note on this) — so the same
          "nothing external configured/found" message keys off the count instead. */}
      {!nothingFoundAnywhere && meta.externalResults === 0 && (
        <p className="mt-6 text-xs font-light text-muted-foreground">{t("externalSkipped")}</p>
      )}
    </>
  );
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
  const tCrewTypes = await getTranslations("discover.crewTypes");

  const resolved = await searchParams;
  const rawQuery = toArray(resolved.q)[0] ?? "";
  const query = rawQuery.slice(0, 500).trim();
  const removed = toArray(resolved.remove);
  const forceExternal = toArray(resolved.external)[0] === "1";

  // Fast half only (spec §5) — interpretation + internal search, no network crawl. Awaited directly
  // (not wrapped in `<Suspense>`) so chips and internal results render as part of the initial
  // response; Э6's candidate/verification phase is kicked off separately, below, inside a
  // `<Suspense>` boundary — unless Internal First (Арх §14) short-circuited it entirely, see
  // `internalPhase.internalFirstShortCircuit` below.
  const internalPhase = query
    ? await runInternalSearchPhase(query, { locale: locale as Locale, removedCriteria: removed, forceExternal })
    : null;

  /** Preserves the query and every dismissed criterion while adding `external=1`. */
  const searchExternalHref = (() => {
    const next = new URLSearchParams();
    next.set("q", query);
    for (const value of removed) next.append("remove", value);
    next.set("external", "1");
    return `/discover?${next.toString()}`;
  })();

  const chips = internalPhase ? criteriaToChips(internalPhase.interpretedCriteria) : [];

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
  const vocabulary = internalPhase ? await buildSearchVocabulary() : null;
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
    if (labelKey === "crewType") return tCrewTypes(String(value));
    if (labelKey === "country" || labelKey === "city" || labelKey === "marina") {
      return placeLabel(labelKey, String(value));
    }
    if (labelKey === "lengthMin" || labelKey === "lengthMax") {
      return t("lengthMeters", { value: Number(value) });
    }
    if (labelKey === "searchRadiusKm") {
      return t("radiusKm", { value: Number(value) });
    }
    if (labelKey === "priceMax") {
      const currency = internalPhase?.interpretedCriteria.price?.currency;
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

        {internalPhase && (
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

            {internalPhase.interpretation.mode !== "AI" && (
              <p className="mt-3 text-xs font-light text-muted-foreground">{t("degraded")}</p>
            )}
          </div>
        )}
      </section>

      {internalPhase && (
        <section className="container-page pb-24">
          {internalPhase.internalResults.length > 0 && (
            <>
              <h2 className="text-lg font-light tracking-tight">
                {t("resultsCount", { count: internalPhase.internalResults.length })}
              </h2>
              <ul className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {internalPhase.internalResults.map((result, index) => (
                  <li key={result.id}>
                    <GlobalResultCard result={result} index={index} />
                  </li>
                ))}
              </ul>
            </>
          )}

          {/* Арх §14's Internal First: internal coverage alone already met `min_internal_results`,
              so the external phase never ran at all — nothing to stream in, only an explicit
              opt-in to run it anyway (see `orchestrator/search-orchestrator.ts`'s own doc comment
              on why this is a dead end with no `<Suspense>` fallback, unlike the branch below). */}
          {internalPhase.internalFirstShortCircuit ? (
            <p className="mt-10 text-xs font-light text-muted-foreground">
              {t("internalFirstNotice")}{" "}
              <Link href={searchExternalHref} className="underline underline-offset-2 hover:text-foreground">
                {t("searchExternalCta")}
              </Link>
            </p>
          ) : (
            // Awaited directly, not streamed — see `ExternalResultsSection`'s own doc comment on
            // why the `<Suspense>` split is temporarily disabled.
            <ExternalResultsSection internalPhase={internalPhase} />
          )}
        </section>
      )}
    </div>
  );
}
