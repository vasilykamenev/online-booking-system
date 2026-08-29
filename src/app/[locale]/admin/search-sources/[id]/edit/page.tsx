import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { getSearchSourceById } from "@/server/queries/admin";
import { buildTitle } from "@/lib/site";
import { SearchSourceForm } from "../../search-source-form";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "admin.searchSources.form" });
  return { title: buildTitle(t("editTitle")) };
}

export default async function EditSearchSourcePage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = (await params) as { locale: Locale; id: string };
  setRequestLocale(locale);
  const t = await getTranslations("admin.searchSources.form");

  const source = await getSearchSourceById(id);
  if (!source) notFound();

  return (
    <div>
      <h1 className="text-xl font-medium tracking-tight">{t("editTitle")}</h1>
      <p className="mt-1 text-sm font-light text-muted-foreground">{t("editSubtitle")}</p>

      <div className="mt-6 rounded-2xl border border-border bg-card p-5 shadow-soft">
        <SearchSourceForm
          mode="edit"
          sourceId={source.id}
          structureHealth={{
            needsReanalysis: source.needsReanalysis,
            sampleSize: source.reanalysisSampleSize,
            successCount: source.reanalysisSuccessCount,
          }}
          defaultValues={{
            name: source.name,
            domain: source.domain,
            baseUrl: source.baseUrl,
            sourceType: source.sourceType,
            processingType: source.processingType,
            priority: source.priority,
            notes: source.notes ?? "",
            selectorConfig: source.selectorConfig ? JSON.stringify(source.selectorConfig, null, 2) : "",
            imageDomains: source.imageDomains.join(", "),
            autoSelectClassifications: source.autoSelectClassifications,
            detailedLogging: source.detailedLogging,
            canDetails: source.canDetails,
            canAvailability: source.canAvailability,
            canPricing: source.canPricing,
            canContact: source.canContact,
            supportsDates: source.supportsDates,
            supportsPrice: source.supportsPrice,
            supportsGuests: source.supportsGuests,
            contactCapability: source.contactCapability,
            coverageWorldwide: source.coverage?.worldwide ?? false,
            coverageCountry: source.coverage?.country ?? "",
            coverageRegion: source.coverage?.region ?? "",
            coverageDestination: source.coverage?.destination ?? "",
            coverageLatitude: source.coverage?.latitude?.toString() ?? "",
            coverageLongitude: source.coverage?.longitude?.toString() ?? "",
            coverageRadiusKm: source.coverage?.radiusKm?.toString() ?? "",
            policies: source.policies
              ? JSON.stringify(
                  {
                    accessPolicy: source.policies.accessPolicy,
                    cachePolicy: source.policies.cachePolicy,
                    attributionPolicy: source.policies.attributionPolicy,
                    rateLimitPolicy: source.policies.rateLimitPolicy,
                    retentionPolicy: source.policies.retentionPolicy,
                  },
                  null,
                  2,
                )
              : "",
          }}
        />
      </div>
    </div>
  );
}
