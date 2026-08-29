"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/routing";
import { Link, useRouter } from "@/i18n/navigation";
import {
  createSearchSource,
  updateSearchSource,
  validateSearchSourceCandidate,
  checkCandidateUrl,
  type SearchSourceActionState,
  type SearchSourceValidationState,
  type CandidateUrlCheckState,
} from "@/server/actions/admin";
import type { CandidatePreviewSample } from "@/server/search/source-validation";
import {
  searchProcessingTypeValues,
  searchSourceTypeValues,
  urlClassificationValues,
  searchContactCapabilityValues,
} from "@/lib/validation/admin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const initialState: SearchSourceActionState = {};

export interface SearchSourceFormDefaultValues {
  name: string;
  domain: string;
  baseUrl: string;
  sourceType: (typeof searchSourceTypeValues)[number];
  processingType: (typeof searchProcessingTypeValues)[number];
  priority: number;
  notes: string;
  /** Raw JSON text, or "" — mirrors the form field's own shape, not the parsed `SelectorConfig`. */
  selectorConfig: string;
  /** Raw comma/newline-separated text, or "" — mirrors the form field's own shape, not the parsed
   *  `string[]`. */
  imageDomains: string;
  autoSelectClassifications: (typeof urlClassificationValues)[number][];
  detailedLogging: boolean;
  canDetails: boolean;
  canAvailability: boolean;
  canPricing: boolean;
  canContact: boolean;
  supportsDates: boolean;
  supportsPrice: boolean;
  supportsGuests: boolean;
  contactCapability: (typeof searchContactCapabilityValues)[number] | null;
  coverageWorldwide: boolean;
  coverageCountry: string;
  coverageRegion: string;
  coverageDestination: string;
  coverageLatitude: string;
  coverageLongitude: string;
  coverageRadiusKm: string;
  /** Raw JSON text, or "" — mirrors the form field's own shape, same convention as `selectorConfig`. */
  policies: string;
}

const GENERIC_SELECTOR_TYPES = new Set<(typeof searchProcessingTypeValues)[number]>(["HTML", "HYBRID"]);

/**
 * One candidate page's full analysis — shared between the auto-sampled list (`candidatePreview`)
 * and the admin-picked single-URL check (`customUrlCheck`), so both show the same depth of detail
 * rather than the sample list getting a summary and the custom check getting something richer (or
 * vice versa).
 */
function CandidateSampleCard({
  sample,
  onApplyImageDomain,
}: {
  sample: CandidatePreviewSample;
  onApplyImageDomain: (domain: string) => void;
}) {
  const tValidation = useTranslations("admin.searchSources.validation");

  if (!sample.fetched) {
    return <p>{tValidation("candidatePreview.fetchFailed")}</p>;
  }

  const fields = sample.extractedFields;

  return (
    <>
      {sample.structuredDataTypes.length > 0 && (
        <p>
          {tValidation("candidatePreview.structuredMatch", { types: sample.structuredDataTypes.join(", ") })}
        </p>
      )}
      {sample.classification &&
        (sample.classification.looksLikeVesselListing ? (
          <p>{tValidation("candidatePreview.aiMatch")}</p>
        ) : (
          <p>{tValidation("candidatePreview.aiNoMatch")}</p>
        ))}
      {fields && (
        <div className="mt-1 flex flex-col gap-0.5 border-t border-border/60 pt-1">
          <p className="font-medium text-foreground">{tValidation("candidatePreview.fields.title")}</p>
          <p>{fields.name ?? tValidation("candidatePreview.unknownField")}</p>
          {fields.description && (
            <p className="truncate" title={fields.description}>
              {tValidation("candidatePreview.fields.description", { description: fields.description })}
            </p>
          )}
          {fields.price !== null ? (
            <p>
              {tValidation("candidatePreview.fields.price", {
                price: fields.price,
                currency: fields.currency ?? "",
              })}
            </p>
          ) : (
            <p>{tValidation("candidatePreview.fields.priceUnknown")}</p>
          )}
          {fields.vesselTypeRaw && (
            <p>{tValidation("candidatePreview.fields.vesselType", { vesselType: fields.vesselTypeRaw })}</p>
          )}
          {fields.country || fields.city ? (
            <p>
              {fields.city
                ? tValidation("candidatePreview.fields.locationBoth", {
                    country: fields.country ?? tValidation("candidatePreview.unknownField"),
                    city: fields.city,
                  })
                : tValidation("candidatePreview.fields.location", { country: fields.country ?? "" })}
            </p>
          ) : (
            <p>{tValidation("candidatePreview.fields.locationUnknown")}</p>
          )}
          {fields.breadcrumbLabels.length > 0 && (
            <p className="truncate" title={fields.breadcrumbLabels.join(" → ")}>
              {tValidation("candidatePreview.fields.breadcrumb", {
                trail: fields.breadcrumbLabels.join(" → "),
              })}
            </p>
          )}
          <div className="mt-0.5 flex flex-wrap items-center gap-2">
            <span className="font-medium text-foreground">{tValidation("candidatePreview.image.title")}:</span>
            {fields.image ? (
              <>
                <span>
                  {fields.image.matchesSourceDomain
                    ? tValidation("candidatePreview.image.ok", { domain: fields.image.domain })
                    : tValidation("candidatePreview.image.mismatch", { domain: fields.image.domain })}
                </span>
                {!fields.image.matchesSourceDomain && (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="rounded-full"
                    onClick={() => onApplyImageDomain(fields.image!.domain)}
                  >
                    {tValidation("candidatePreview.image.applyDomain")}
                  </Button>
                )}
              </>
            ) : (
              <span>{tValidation("candidatePreview.image.none")}</span>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export interface SearchSourceStructureHealth {
  needsReanalysis: boolean;
  sampleSize: number | null;
  successCount: number | null;
}

export function SearchSourceForm({
  mode = "create",
  sourceId,
  defaultValues,
  structureHealth,
}: {
  mode?: "create" | "edit";
  sourceId?: string;
  defaultValues?: SearchSourceFormDefaultValues;
  /** Э10 — only ever set in edit mode; a source being created has no indexing history yet to have
   *  flagged it. */
  structureHealth?: SearchSourceStructureHealth;
}) {
  const t = useTranslations("admin.searchSources.form");
  const tProcessing = useTranslations("admin.searchSources.processingType");
  const tProcessingHint = useTranslations("admin.searchSources.processingTypeHint");
  const tSourceType = useTranslations("admin.searchSources.sourceType");
  const tClassification = useTranslations("admin.searchSources.classification");
  const tContactCapability = useTranslations("admin.searchSources.contactCapability");
  const tValidation = useTranslations("admin.searchSources.validation");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const prevStateRef = useRef(initialState);
  const action =
    mode === "create"
      ? createSearchSource.bind(null, locale)
      : updateSearchSource.bind(null, locale, sourceId!);
  const [state, formAction, isPending] = useActionState(action, initialState);
  const [processingType, setProcessingType] = useState<(typeof searchProcessingTypeValues)[number]>(
    defaultValues?.processingType ?? "HTML",
  );
  const [selectorConfigText, setSelectorConfigText] = useState(defaultValues?.selectorConfig ?? "");
  const [name, setName] = useState(defaultValues?.name ?? "");
  const [domain, setDomain] = useState(defaultValues?.domain ?? "");
  const [imageDomainsText, setImageDomainsText] = useState(defaultValues?.imageDomains ?? "");
  const [validation, setValidation] = useState<SearchSourceValidationState | null>(null);
  const [isValidating, startValidation] = useTransition();
  const [customUrl, setCustomUrl] = useState("");
  const [customUrlCheck, setCustomUrlCheck] = useState<CandidateUrlCheckState | null>(null);
  const [isCheckingUrl, startUrlCheck] = useTransition();

  /** Appends `domain` to the Image domains field, skipping it if already present — the one-click
   *  counterpart to the mismatch warning `CandidatePreviewCard` shows (see its own doc comment for
   *  why a source's photos can live on a different host than its pages). */
  function handleApplyImageDomain(domain: string) {
    setImageDomainsText((current) => {
      const existing = current
        .split(/[,\n]/)
        .map((entry) => entry.trim())
        .filter(Boolean);
      if (existing.includes(domain)) return current;
      return existing.length > 0 ? `${current.trim()}, ${domain}` : domain;
    });
  }

  function handleCheckUrl() {
    const input = formRef.current?.elements.namedItem("baseUrl");
    const baseUrl = input instanceof HTMLInputElement ? input.value : "";
    const trimmedCandidate = customUrl.trim();
    startUrlCheck(async () => {
      const result = await checkCandidateUrl(baseUrl, trimmedCandidate);
      setCustomUrlCheck(result);
    });
  }

  /** Best-effort hostname for the Domain field's autofill — the same `DOMAIN_PATTERN` convention
   *  existing sources already follow (`globesailor.ru`, `brilions.com`: no `www.`, no scheme). Never
   *  thrown on a malformed URL — the field just stays whatever it already was. */
  function hostnameFrom(url: string): string | null {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return null;
    }
  }

  function handleValidate() {
    const input = formRef.current?.elements.namedItem("baseUrl");
    const baseUrl = input instanceof HTMLInputElement ? input.value : "";
    startValidation(async () => {
      const result = await validateSearchSourceCandidate(baseUrl);
      setValidation(result);

      // Only when empty: this must never overwrite something the admin already typed, including a
      // deliberate correction made after a previous Check.
      if (result.report) {
        if (!name.trim() && result.report.suggestedName) setName(result.report.suggestedName);
        if (!domain.trim()) {
          const hostname = hostnameFrom(result.report.finalUrl ?? baseUrl);
          if (hostname) setDomain(hostname);
        }
      }
    });
  }
  // Tracks which `state` the processingType hint was last adjusted for, so a successful create
  // can reset it back to the default in the same render — setState-in-render is the React-endorsed
  // way to do this, unlike setState-in-effect, which would cause an extra cascading render. Only
  // relevant in create mode: a successful edit navigates away via `redirect()` in the server
  // action, so `state` never comes back with a non-error value to react to.
  const [adjustedForState, setAdjustedForState] = useState(state);
  if (mode === "create" && state !== adjustedForState) {
    setAdjustedForState(state);
    if (!state.error) {
      setProcessingType("HTML");
      setSelectorConfigText("");
      setValidation(null);
      setCustomUrl("");
      setCustomUrlCheck(null);
      // `name`/`domain`/`imageDomainsText` are now controlled (autofill and the image-domain "apply"
      // button both need to read/write them), so `formRef.reset()` below only clears the DOM — these
      // must be cleared here too, or the next render would put the just-submitted values right back
      // via `value={name}`/`value={domain}`/`value={imageDomainsText}`.
      setName("");
      setDomain("");
      setImageDomainsText("");
    }
  }

  useEffect(() => {
    if (mode === "create" && state !== prevStateRef.current) {
      prevStateRef.current = state;
      if (!state.error) {
        formRef.current?.reset();
        router.refresh();
      }
    }
  }, [mode, state, router]);

  return (
    <form ref={formRef} action={formAction} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {structureHealth?.needsReanalysis && (
        <div className="flex flex-col gap-1 rounded-2xl border border-destructive/40 bg-destructive/5 p-4 text-sm sm:col-span-2">
          <p className="font-medium text-destructive">{t("structureHealth.title")}</p>
          <p className="font-light text-muted-foreground">
            {structureHealth.sampleSize !== null && structureHealth.successCount !== null
              ? t("structureHealth.detail", {
                  success: structureHealth.successCount,
                  total: structureHealth.sampleSize,
                })
              : t("structureHealth.detailUnknown")}
          </p>
          <p className="font-light text-muted-foreground">{t("structureHealth.hint")}</p>
        </div>
      )}
      <div className="flex flex-col gap-2">
        <Label htmlFor="name">{t("name")}</Label>
        <Input
          id="name"
          name="name"
          placeholder={t("namePlaceholder")}
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="domain">{t("domain")}</Label>
        <Input
          id="domain"
          name="domain"
          placeholder={t("domainPlaceholder")}
          value={domain}
          onChange={(event) => setDomain(event.target.value)}
          required
        />
      </div>
      <div className="flex flex-col gap-2 sm:col-span-2">
        <Label htmlFor="baseUrl">{t("baseUrl")}</Label>
        <div className="flex gap-2">
          <Input
            id="baseUrl"
            name="baseUrl"
            type="url"
            placeholder={t("baseUrlPlaceholder")}
            defaultValue={defaultValues?.baseUrl}
            required
            className="flex-1"
          />
          <Button
            type="button"
            variant="outline"
            className="shrink-0 rounded-full"
            disabled={isValidating}
            onClick={handleValidate}
          >
            {isValidating ? tValidation("checking") : tValidation("checkButton")}
          </Button>
        </div>
      </div>

      {validation && (
        <div className="flex flex-col gap-1.5 rounded-2xl border border-border bg-muted/40 p-4 text-sm sm:col-span-2">
          {validation.error ? (
            <p className="text-destructive">{tValidation(`errors.${validation.error}`)}</p>
          ) : validation.report ? (
            <>
              <p className="font-medium">{tValidation("title")}</p>
              <p className="font-light text-muted-foreground">
                {validation.report.reachable
                  ? tValidation("reachable.ok", { status: validation.report.status ?? 0 })
                  : tValidation(`reachable.reasons.${validation.report.failureReason}`, {
                      status: validation.report.status ?? "—",
                    })}
              </p>
              <p className="font-light text-muted-foreground">
                {validation.report.robotsTxt.found
                  ? tValidation("robots.found")
                  : tValidation("robots.notFound")}
                {" — "}
                {validation.report.robotsTxt.allowsBasePath
                  ? tValidation("robots.allowed")
                  : tValidation("robots.disallowed")}
              </p>
              <p className="font-light text-muted-foreground">
                {validation.report.sitemap.found
                  ? tValidation("sitemap.found", {
                      url: validation.report.sitemap.url ?? "",
                      count: validation.report.sitemap.entryCount ?? 0,
                    })
                  : tValidation("sitemap.notFound")}
              </p>
              <p className="font-light text-muted-foreground">
                {validation.report.structuredData.found
                  ? tValidation("structuredData.found", {
                      types: validation.report.structuredData.types.join(", "),
                    })
                  : tValidation("structuredData.notFound")}
              </p>
              <p className="font-light text-muted-foreground">
                {validation.report.apiEndpoint.found
                  ? tValidation("apiEndpoint.found", { url: validation.report.apiEndpoint.url ?? "" })
                  : tValidation("apiEndpoint.notFound")}
              </p>
              <p className="font-light text-muted-foreground">
                {validation.report.graphqlEndpoint.found
                  ? tValidation("graphqlEndpoint.found", { url: validation.report.graphqlEndpoint.url ?? "" })
                  : tValidation("graphqlEndpoint.notFound")}
              </p>
              <p className="font-light text-muted-foreground">
                {validation.report.searchForm.found
                  ? tValidation("searchForm.found", {
                      action: validation.report.searchForm.action ?? "",
                      fields: validation.report.searchForm.fieldNames.join(", "),
                    })
                  : tValidation("searchForm.notFound")}
              </p>
              {validation.report.suggestedProcessingType && (
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span>
                    {tValidation("suggestion", {
                      type: tProcessing(validation.report.suggestedProcessingType),
                    })}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="rounded-full"
                    onClick={() =>
                      setProcessingType(validation.report!.suggestedProcessingType!)
                    }
                  >
                    {tValidation("apply")}
                  </Button>
                </div>
              )}
              {validation.report.suggestedSelectorConfig && (
                <div className="flex flex-wrap items-center gap-2">
                  <span>{tValidation("suggestedSelectors")}</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="rounded-full"
                    onClick={() => {
                      setProcessingType((current) => (GENERIC_SELECTOR_TYPES.has(current) ? current : "HTML"));
                      setSelectorConfigText(
                        JSON.stringify(validation.report!.suggestedSelectorConfig, null, 2),
                      );
                    }}
                  >
                    {tValidation("apply")}
                  </Button>
                </div>
              )}

              <div className="mt-2 flex flex-col gap-1.5 border-t border-border pt-2">
                <p className="font-medium">{tValidation("candidatePreview.title")}</p>
                {!validation.report.candidatePreview.attempted ? (
                  <p className="font-light text-muted-foreground">
                    {tValidation("candidatePreview.unavailable")}
                  </p>
                ) : (
                  <>
                    <p className="font-light text-muted-foreground">
                      {tValidation("candidatePreview.summary", {
                        matched: validation.report.candidatePreview.samples.filter(
                          (sample) =>
                            sample.structuredDataTypes.length > 0 ||
                            sample.classification?.looksLikeVesselListing,
                        ).length,
                        total: validation.report.candidatePreview.samples.length,
                      })}
                    </p>
                    <ul className="flex flex-col gap-1">
                      {validation.report.candidatePreview.samples.map((sample) => (
                        <li
                          key={sample.url}
                          className="rounded-lg border border-border bg-card px-3 py-2 font-light text-muted-foreground"
                        >
                          <p className="truncate text-xs" title={sample.url}>
                            {sample.url}
                          </p>
                          <CandidateSampleCard sample={sample} onApplyImageDomain={handleApplyImageDomain} />
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>

              <div className="mt-2 flex flex-col gap-1.5 border-t border-border pt-2">
                <p className="font-medium">{tValidation("customUrlCheck.title")}</p>
                <p className="text-xs font-light text-muted-foreground">
                  {tValidation("customUrlCheck.hint")}
                </p>
                <div className="flex gap-2">
                  <Input
                    value={customUrl}
                    onChange={(event) => setCustomUrl(event.target.value)}
                    placeholder={tValidation("customUrlCheck.placeholder")}
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="shrink-0 rounded-full"
                    disabled={isCheckingUrl || !customUrl.trim()}
                    onClick={handleCheckUrl}
                  >
                    {isCheckingUrl ? tValidation("customUrlCheck.checking") : tValidation("customUrlCheck.button")}
                  </Button>
                </div>
                {customUrlCheck?.error && (
                  <p className="text-destructive">{tValidation(`errors.${customUrlCheck.error}`)}</p>
                )}
                {customUrlCheck?.sample && (
                  <ul className="flex flex-col gap-1">
                    <li className="rounded-lg border border-border bg-card px-3 py-2 font-light text-muted-foreground">
                      <p className="truncate text-xs" title={customUrlCheck.sample.url}>
                        {customUrlCheck.sample.url}
                      </p>
                      <CandidateSampleCard sample={customUrlCheck.sample} onApplyImageDomain={handleApplyImageDomain} />
                    </li>
                  </ul>
                )}
              </div>
            </>
          ) : null}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor="sourceType">{t("sourceType")}</Label>
        <Select name="sourceType" defaultValue={defaultValues?.sourceType ?? searchSourceTypeValues[0]}>
          <SelectTrigger id="sourceType" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {searchSourceTypeValues.map((value) => (
              <SelectItem key={value} value={value}>
                {tSourceType(value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="processingType">{t("processingType")}</Label>
        <Select
          name="processingType"
          value={processingType}
          onValueChange={(value) =>
            setProcessingType(value as (typeof searchProcessingTypeValues)[number])
          }
        >
          <SelectTrigger id="processingType" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {searchProcessingTypeValues.map((value) => (
              <SelectItem key={value} value={value}>
                {tProcessing(value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs font-light text-muted-foreground">
          {tProcessingHint(processingType)}
        </p>
      </div>
      {GENERIC_SELECTOR_TYPES.has(processingType) && (
        <div className="flex flex-col gap-2 sm:col-span-2">
          <Label htmlFor="selectorConfig">{t("selectorConfig")}</Label>
          <Textarea
            id="selectorConfig"
            name="selectorConfig"
            rows={6}
            className="font-mono text-xs"
            placeholder={t("selectorConfigPlaceholder")}
            value={selectorConfigText}
            onChange={(event) => setSelectorConfigText(event.target.value)}
          />
          <p className="text-xs font-light text-muted-foreground">{t("selectorConfigHint")}</p>
        </div>
      )}
      <div className="flex flex-col gap-2 sm:col-span-2">
        <Label htmlFor="imageDomains">{t("imageDomains")}</Label>
        <Input
          id="imageDomains"
          name="imageDomains"
          placeholder={t("imageDomainsPlaceholder")}
          value={imageDomainsText}
          onChange={(event) => setImageDomainsText(event.target.value)}
        />
        <p className="text-xs font-light text-muted-foreground">{t("imageDomainsHint")}</p>
      </div>
      <div className="flex flex-col gap-2 sm:col-span-2">
        <Label>{t("autoSelectClassifications")}</Label>
        <div className="flex flex-wrap gap-4">
          {urlClassificationValues.map((value) => (
            <label key={value} className="group flex items-center gap-2 text-sm font-light">
              <Checkbox
                name="autoSelectClassifications"
                value={value}
                defaultChecked={defaultValues?.autoSelectClassifications?.includes(value) ?? value === "HIGH"}
              />
              {tClassification(value)}
            </label>
          ))}
        </div>
        <p className="text-xs font-light text-muted-foreground">{t("autoSelectClassificationsHint")}</p>
      </div>
      <div className="flex flex-col gap-2 sm:col-span-2">
        <label className="group flex items-center gap-2 text-sm font-light">
          <Checkbox
            id="detailedLogging"
            name="detailedLogging"
            defaultChecked={defaultValues?.detailedLogging ?? false}
          />
          {t("detailedLogging")}
        </label>
        <p className="text-xs font-light text-muted-foreground">{t("detailedLoggingHint")}</p>
      </div>

      <div className="flex flex-col gap-2 sm:col-span-2">
        <Label>{t("capabilities")}</Label>
        <p className="text-xs font-light text-muted-foreground">{t("capabilitiesHint")}</p>
        <div className="flex flex-wrap gap-4">
          {(
            [
              ["canDetails", defaultValues?.canDetails],
              ["canAvailability", defaultValues?.canAvailability],
              ["canPricing", defaultValues?.canPricing],
              ["canContact", defaultValues?.canContact],
              ["supportsDates", defaultValues?.supportsDates],
              ["supportsPrice", defaultValues?.supportsPrice],
              ["supportsGuests", defaultValues?.supportsGuests],
            ] as const
          ).map(([name, checked]) => (
            <label key={name} className="group flex items-center gap-2 text-sm font-light">
              <Checkbox name={name} defaultChecked={checked ?? false} />
              {t(`capability.${name}`)}
            </label>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:col-span-2">
        <Label htmlFor="contactCapability">{t("contactCapability")}</Label>
        <Select name="contactCapability" defaultValue={defaultValues?.contactCapability ?? ""}>
          <SelectTrigger id="contactCapability" className="w-full">
            <SelectValue placeholder={t("contactCapabilityNone")} />
          </SelectTrigger>
          <SelectContent>
            {searchContactCapabilityValues.map((value) => (
              <SelectItem key={value} value={value}>
                {tContactCapability(value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-2 sm:col-span-2 rounded-2xl border border-border p-4">
        <Label>{t("coverage")}</Label>
        <p className="text-xs font-light text-muted-foreground">{t("coverageHint")}</p>
        <label className="group flex items-center gap-2 text-sm font-light">
          <Checkbox name="coverageWorldwide" defaultChecked={defaultValues?.coverageWorldwide ?? false} />
          {t("coverageWorldwide")}
        </label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Input
            name="coverageCountry"
            placeholder={t("coverageCountryPlaceholder")}
            defaultValue={defaultValues?.coverageCountry}
          />
          <Input
            name="coverageRegion"
            placeholder={t("coverageRegionPlaceholder")}
            defaultValue={defaultValues?.coverageRegion}
          />
          <Input
            name="coverageDestination"
            placeholder={t("coverageDestinationPlaceholder")}
            defaultValue={defaultValues?.coverageDestination}
          />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Input
            name="coverageLatitude"
            type="number"
            step="any"
            placeholder={t("coverageLatitudePlaceholder")}
            defaultValue={defaultValues?.coverageLatitude}
          />
          <Input
            name="coverageLongitude"
            type="number"
            step="any"
            placeholder={t("coverageLongitudePlaceholder")}
            defaultValue={defaultValues?.coverageLongitude}
          />
          <Input
            name="coverageRadiusKm"
            type="number"
            step="any"
            placeholder={t("coverageRadiusKmPlaceholder")}
            defaultValue={defaultValues?.coverageRadiusKm}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:col-span-2">
        <Label htmlFor="policies">{t("policies")}</Label>
        <Textarea
          id="policies"
          name="policies"
          rows={6}
          className="font-mono text-xs"
          placeholder={t("policiesPlaceholder")}
          defaultValue={defaultValues?.policies}
        />
        <p className="text-xs font-light text-muted-foreground">{t("policiesHint")}</p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="priority">{t("priority")}</Label>
        <Input
          id="priority"
          name="priority"
          type="number"
          min={0}
          max={1000}
          defaultValue={defaultValues?.priority ?? 50}
        />
        <p className="text-xs font-light text-muted-foreground">{t("priorityHint")}</p>
      </div>
      <div className="flex flex-col gap-2 sm:col-span-2">
        <Label htmlFor="notes">{t("notes")}</Label>
        <Textarea
          id="notes"
          name="notes"
          rows={2}
          placeholder={t("notesPlaceholder")}
          defaultValue={defaultValues?.notes}
        />
      </div>

      {state.error && (
        <p className="text-sm text-destructive sm:col-span-2">{t(`errors.${state.error}`)}</p>
      )}

      <div className="flex items-center gap-2 sm:col-span-2">
        <Button type="submit" disabled={isPending} className="rounded-full sm:w-fit">
          {isPending && <Loader2 className="size-4 animate-spin" strokeWidth={1.5} />}
          {mode === "create" ? t("add") : t("save")}
        </Button>
        {mode === "edit" && (
          <Button asChild type="button" variant="outline" className="rounded-full sm:w-fit">
            <Link href="/admin/search-sources">{t("cancel")}</Link>
          </Button>
        )}
      </div>
    </form>
  );
}
