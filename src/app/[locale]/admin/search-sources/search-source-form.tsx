"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/routing";
import { useRouter } from "@/i18n/navigation";
import {
  createSearchSource,
  updateSearchSource,
  validateSearchSourceCandidate,
  type SearchSourceActionState,
  type SearchSourceValidationState,
} from "@/server/actions/admin";
import {
  searchProcessingTypeValues,
  searchSourceTypeValues,
} from "@/lib/validation/admin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
}

export function SearchSourceForm({
  mode = "create",
  sourceId,
  defaultValues,
}: {
  mode?: "create" | "edit";
  sourceId?: string;
  defaultValues?: SearchSourceFormDefaultValues;
}) {
  const t = useTranslations("admin.searchSources.form");
  const tProcessing = useTranslations("admin.searchSources.processingType");
  const tProcessingHint = useTranslations("admin.searchSources.processingTypeHint");
  const tSourceType = useTranslations("admin.searchSources.sourceType");
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
  const [validation, setValidation] = useState<SearchSourceValidationState | null>(null);
  const [isValidating, startValidation] = useTransition();

  function handleValidate() {
    const input = formRef.current?.elements.namedItem("baseUrl");
    const baseUrl = input instanceof HTMLInputElement ? input.value : "";
    startValidation(async () => {
      setValidation(await validateSearchSourceCandidate(baseUrl));
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
      setValidation(null);
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
      <div className="flex flex-col gap-2">
        <Label htmlFor="name">{t("name")}</Label>
        <Input
          id="name"
          name="name"
          placeholder={t("namePlaceholder")}
          defaultValue={defaultValues?.name}
          required
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="domain">{t("domain")}</Label>
        <Input
          id="domain"
          name="domain"
          placeholder={t("domainPlaceholder")}
          defaultValue={defaultValues?.domain}
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
                          {!sample.fetched ? (
                            <p>{tValidation("candidatePreview.fetchFailed")}</p>
                          ) : sample.structuredDataTypes.length > 0 ? (
                            <p>
                              {tValidation("candidatePreview.structuredMatch", {
                                types: sample.structuredDataTypes.join(", "),
                              })}
                            </p>
                          ) : sample.classification?.looksLikeVesselListing ? (
                            <>
                              <p>{tValidation("candidatePreview.aiMatch")}</p>
                              <p>
                                {tValidation("candidatePreview.extracted", {
                                  name:
                                    sample.classification.extracted.name ??
                                    tValidation("candidatePreview.unknownField"),
                                  guests:
                                    sample.classification.extracted.guests ??
                                    tValidation("candidatePreview.unknownField"),
                                  cabins:
                                    sample.classification.extracted.cabins ??
                                    tValidation("candidatePreview.unknownField"),
                                })}
                              </p>
                            </>
                          ) : (
                            <p>{tValidation("candidatePreview.aiNoMatch")}</p>
                          )}
                        </li>
                      ))}
                    </ul>
                  </>
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

      <Button
        type="submit"
        disabled={isPending}
        className="rounded-full sm:col-span-2 sm:w-fit"
      >
        {mode === "create" ? t("add") : t("save")}
      </Button>
    </form>
  );
}
