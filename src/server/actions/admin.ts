"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database, Json } from "@/lib/supabase/database.types";
import {
  LISTING_FIELDS,
  type ListingFieldName,
  type ListingFieldProvenance,
  type ListingFieldValue,
} from "@/server/search/registry/listing-merge";
import {
  updateUserRoleSchema,
  locationSchema,
  amenityKeySchema,
  commissionRateSchema,
  searchSourceSchema,
  crawlRuleSchema,
  parseSelectorConfig,
  parseImageDomains,
  parseCoverageInput,
  parseSourcePolicies,
  type SourcePoliciesInput,
  type userRoleValues,
} from "@/lib/validation/admin";
import { accessStrategyFromProcessingType } from "@/server/search/source-registry";
import { indexSource } from "@/server/search/index/indexer";
import {
  validateSearchSource,
  previewCandidateAtUrl,
  type SourceValidationReport,
  type CandidatePreviewSample,
} from "@/server/search/source-validation";
import {
  syncSourceUrlRegistry,
  reclassifyStoredUrls,
  previewSourceCrawlClassification,
  addManualUrls,
  type CrawlPreviewResult,
} from "@/server/search/registry/url-registry-sync";
import { fetchRobotsInfo } from "@/server/search/crawl/robots";
import { getSearchSourceReindexProgress, type AdminReindexProgress } from "@/server/queries/admin";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/** RLS's audit_log_admin_insert policy requires admin_id = auth.uid() and is_admin() —
 * both already true for every caller here, since every action below re-checks the role first. */
async function logAudit(
  supabase: SupabaseServerClient,
  adminId: string,
  action: string,
  targetTable: string,
  targetId: string | null,
  meta: Record<string, Json> = {},
): Promise<void> {
  await supabase.from("audit_log").insert({
    admin_id: adminId,
    action,
    target_table: targetTable,
    target_id: targetId,
    meta,
  });
}

async function requireAdmin(
  supabase: SupabaseServerClient,
): Promise<{ id: string } | { error: "unauthenticated" | "forbidden" }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "unauthenticated" };

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") return { error: "forbidden" };

  return { id: user.id };
}

export interface UpdateUserRoleResult {
  error?: "unauthenticated" | "forbidden" | "invalid" | "cannotChangeOwnRole" | "generic";
}

export async function updateUserRole(
  locale: Locale,
  userId: string,
  role: (typeof userRoleValues)[number],
): Promise<UpdateUserRoleResult> {
  const parsed = updateUserRoleSchema.safeParse({ userId, role });
  if (!parsed.success) return { error: "invalid" };

  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if ("error" in admin) return { error: admin.error };
  // A demoted admin can't undo it themselves anymore — block it here rather than
  // relying on someone else noticing the panel is now unreachable.
  if (admin.id === parsed.data.userId && parsed.data.role !== "admin") {
    return { error: "cannotChangeOwnRole" };
  }

  const { error } = await supabase
    .from("profiles")
    .update({ role: parsed.data.role })
    .eq("id", parsed.data.userId);
  if (error) return { error: "generic" };

  await logAudit(supabase, admin.id, "update_role", "profiles", parsed.data.userId, {
    role: parsed.data.role,
  });

  revalidatePath(`/${locale}/admin/users`);
  return {};
}

export interface CommissionActionState {
  error?: "unauthenticated" | "forbidden" | "invalid" | "generic";
  success?: boolean;
}

export async function updateCommissionRate(
  locale: Locale,
  _prevState: CommissionActionState,
  formData: FormData,
): Promise<CommissionActionState> {
  const parsed = commissionRateSchema.safeParse({ ratePercent: formData.get("ratePercent") });
  if (!parsed.success) return { error: "invalid" };

  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if ("error" in admin) return { error: admin.error };

  const rate = parsed.data.ratePercent / 100;
  const { error } = await supabase
    .from("platform_settings")
    .update({ commission_rate: rate })
    .eq("id", true);
  if (error) return { error: "generic" };

  await logAudit(supabase, admin.id, "update_commission_rate", "platform_settings", null, { rate });

  revalidatePath(`/${locale}/admin/commissions`);
  return { success: true };
}

export interface LocationActionState {
  error?: string;
}

function parseLocationForm(formData: FormData) {
  return locationSchema.safeParse({
    countryRu: formData.get("countryRu"),
    countryEn: formData.get("countryEn"),
    cityRu: formData.get("cityRu"),
    cityEn: formData.get("cityEn"),
    marinaRu: formData.get("marinaRu"),
    marinaEn: formData.get("marinaEn"),
    latitude: formData.get("latitude"),
    longitude: formData.get("longitude"),
  });
}

function toLocationRow(data: ReturnType<typeof locationSchema.parse>) {
  return {
    country: { ru: data.countryRu, en: data.countryEn },
    city: { ru: data.cityRu, en: data.cityEn },
    marina: data.marinaRu || data.marinaEn ? { ru: data.marinaRu, en: data.marinaEn } : null,
    latitude: data.latitude,
    longitude: data.longitude,
  };
}

export async function createLocation(
  locale: Locale,
  _prevState: LocationActionState,
  formData: FormData,
): Promise<LocationActionState> {
  const parsed = parseLocationForm(formData);
  if (!parsed.success) return { error: "invalid" };

  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if ("error" in admin) return { error: admin.error };

  const { data: location, error } = await supabase
    .from("locations")
    .insert(toLocationRow(parsed.data))
    .select("id")
    .single();
  if (error) return { error: "generic" };

  await logAudit(supabase, admin.id, "create_location", "locations", location.id);

  revalidatePath(`/${locale}/admin/locations`);
  return redirect({ href: "/admin/locations", locale });
}

export async function updateLocation(
  locale: Locale,
  locationId: string,
  _prevState: LocationActionState,
  formData: FormData,
): Promise<LocationActionState> {
  const parsed = parseLocationForm(formData);
  if (!parsed.success) return { error: "invalid" };

  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if ("error" in admin) return { error: admin.error };

  const { error } = await supabase
    .from("locations")
    .update(toLocationRow(parsed.data))
    .eq("id", locationId);
  if (error) return { error: "generic" };

  await logAudit(supabase, admin.id, "update_location", "locations", locationId);

  revalidatePath(`/${locale}/admin/locations`);
  return redirect({ href: "/admin/locations", locale });
}

export interface DeleteResult {
  error?: "unauthenticated" | "forbidden" | "inUse" | "generic";
}

export async function deleteLocation(locale: Locale, locationId: string): Promise<DeleteResult> {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if ("error" in admin) return { error: admin.error };

  const { error } = await supabase.from("locations").delete().eq("id", locationId);
  if (error) {
    // 23503 = foreign_key_violation — a vessel still references this location.
    return { error: error.code === "23503" ? "inUse" : "generic" };
  }

  await logAudit(supabase, admin.id, "delete_location", "locations", locationId);

  revalidatePath(`/${locale}/admin/locations`);
  return {};
}

export interface AmenityActionState {
  error?: string;
}

export async function createAmenity(
  locale: Locale,
  _prevState: AmenityActionState,
  formData: FormData,
): Promise<AmenityActionState> {
  const parsed = amenityKeySchema.safeParse({ key: formData.get("key") });
  if (!parsed.success) return { error: "invalid" };

  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if ("error" in admin) return { error: admin.error };

  const { data: amenity, error } = await supabase
    .from("amenities")
    .insert({ key: parsed.data.key })
    .select("id")
    .single();
  if (error) return { error: error.code === "23505" ? "keyTaken" : "generic" };

  await logAudit(supabase, admin.id, "create_amenity", "amenities", amenity.id, {
    key: parsed.data.key,
  });

  revalidatePath(`/${locale}/admin/amenities`);
  return {};
}

export async function deleteAmenity(locale: Locale, amenityId: string): Promise<DeleteResult> {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if ("error" in admin) return { error: admin.error };

  const { error } = await supabase.from("amenities").delete().eq("id", amenityId);
  if (error) return { error: "generic" };

  await logAudit(supabase, admin.id, "delete_amenity", "amenities", amenityId);

  revalidatePath(`/${locale}/admin/amenities`);
  return {};
}

export interface SearchSourceValidationState {
  error?: "unauthenticated" | "forbidden" | "invalid" | "generic";
  report?: SourceValidationReport;
}

/**
 * Read-only pre-registration probe (spec §9) for the "Проверить" button in the search-source form
 * — never writes to `search_sources`, just gives the admin a live report to decide on before
 * `createSearchSource` runs. See `source-validation.ts` for why it doesn't cache `robots_allows`.
 */
export async function validateSearchSourceCandidate(
  baseUrl: string,
): Promise<SearchSourceValidationState> {
  const parsed = searchSourceSchema.shape.baseUrl.safeParse(baseUrl);
  if (!parsed.success) return { error: "invalid" };

  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if ("error" in admin) return { error: admin.error };

  try {
    const report = await validateSearchSource(parsed.data);
    return { report };
  } catch {
    return { error: "generic" };
  }
}

export interface CandidateUrlCheckState {
  error?: "unauthenticated" | "forbidden" | "invalid" | "generic";
  sample?: CandidatePreviewSample;
}

/**
 * The single-URL counterpart to `validateSearchSourceCandidate` — lets an admin check one specific
 * page (a real listing they already found by browsing the site, not necessarily one of the
 * sitemap's first few entries) instead of waiting on a fresh random sample. Same read-only contract:
 * never writes to `search_sources`.
 */
export async function checkCandidateUrl(
  baseUrl: string,
  candidateUrl: string,
): Promise<CandidateUrlCheckState> {
  const baseParsed = searchSourceSchema.shape.baseUrl.safeParse(baseUrl);
  const candidateParsed = searchSourceSchema.shape.baseUrl.safeParse(candidateUrl);
  if (!baseParsed.success || !candidateParsed.success) return { error: "invalid" };

  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if ("error" in admin) return { error: admin.error };

  try {
    const sample = await previewCandidateAtUrl(baseParsed.data, candidateParsed.data);
    return { sample };
  } catch {
    return { error: "generic" };
  }
}

export interface SearchSourceActionState {
  error?: string;
}

/**
 * Replaces a source's single coverage row and its policies row (Э3, Арх §9/§24). Coverage is
 * delete-then-insert-if-present rather than upsert: the admin form edits one row at a time (see
 * `parseCoverageInput`'s own doc comment on the one-row-per-source simplification), so "the admin
 * cleared every coverage field" must delete the row, not leave a stale one an upsert would never
 * touch. Policies is a genuine upsert — `search_source_policies.source_id` is its primary key, and
 * "leave every policy blank" is a legitimate steady state (an all-default row), not a delete.
 */
async function replaceSourceCoverageAndPolicies(
  supabase: Awaited<ReturnType<typeof createClient>>,
  sourceId: string,
  parsed: { coverage: ReturnType<typeof parseCoverageInput>; policies: SourcePoliciesInput | null },
): Promise<void> {
  await supabase.from("search_source_coverage").delete().eq("source_id", sourceId);
  if (parsed.coverage) {
    await supabase.from("search_source_coverage").insert({
      source_id: sourceId,
      worldwide: parsed.coverage.worldwide,
      country: parsed.coverage.country,
      region: parsed.coverage.region,
      destination: parsed.coverage.destination,
      latitude: parsed.coverage.latitude,
      longitude: parsed.coverage.longitude,
      radius_km: parsed.coverage.radiusKm,
    });
  }

  await supabase.from("search_source_policies").upsert({
    source_id: sourceId,
    access_policy: (parsed.policies?.accessPolicy ?? {}) as Json,
    cache_policy: (parsed.policies?.cachePolicy ?? {}) as Json,
    attribution_policy: (parsed.policies?.attributionPolicy ?? {}) as Json,
    rate_limit_policy: (parsed.policies?.rateLimitPolicy ?? {}) as Json,
    retention_policy: (parsed.policies?.retentionPolicy ?? {}) as Json,
  });
}

export async function createSearchSource(
  locale: Locale,
  _prevState: SearchSourceActionState,
  formData: FormData,
): Promise<SearchSourceActionState> {
  const parsed = searchSourceSchema.safeParse({
    name: formData.get("name"),
    domain: formData.get("domain"),
    baseUrl: formData.get("baseUrl"),
    sourceType: formData.get("sourceType"),
    processingType: formData.get("processingType"),
    priority: formData.get("priority"),
    notes: formData.get("notes"),
    // Absent (not just empty) when the form hid this field for the current processingType — the
    // schema's `.default("")` only kicks in for `undefined`, so `null` needs coalescing here too.
    selectorConfig: formData.get("selectorConfig") ?? "",
    imageDomains: formData.get("imageDomains") ?? "",
    autoSelectClassifications: formData.getAll("autoSelectClassifications"),
    detailedLogging: formData.get("detailedLogging"),
    canDetails: formData.get("canDetails"),
    canAvailability: formData.get("canAvailability"),
    canPricing: formData.get("canPricing"),
    canContact: formData.get("canContact"),
    supportsDates: formData.get("supportsDates"),
    supportsPrice: formData.get("supportsPrice"),
    supportsGuests: formData.get("supportsGuests"),
    contactCapability: formData.get("contactCapability") ?? "",
    coverageWorldwide: formData.get("coverageWorldwide"),
    coverageCountry: formData.get("coverageCountry") ?? "",
    coverageRegion: formData.get("coverageRegion") ?? "",
    coverageDestination: formData.get("coverageDestination") ?? "",
    coverageLatitude: formData.get("coverageLatitude") ?? "",
    coverageLongitude: formData.get("coverageLongitude") ?? "",
    coverageRadiusKm: formData.get("coverageRadiusKm") ?? "",
    policies: formData.get("policies") ?? "",
  });
  if (!parsed.success) return { error: "invalid" };

  const selectorConfig = parseSelectorConfig(parsed.data.selectorConfig);
  if (!selectorConfig.ok) return { error: "selectorConfigInvalid" };
  const imageDomains = parseImageDomains(parsed.data.imageDomains);
  if (!imageDomains.ok) return { error: "imageDomainsInvalid" };
  const coverage = parseCoverageInput(parsed.data);
  const policies = parseSourcePolicies(parsed.data.policies);
  if (!policies.ok) return { error: "policiesInvalid" };

  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if ("error" in admin) return { error: admin.error };

  const { data: source, error } = await supabase
    .from("search_sources")
    .insert({
      name: parsed.data.name,
      domain: parsed.data.domain,
      base_url: parsed.data.baseUrl,
      source_type: parsed.data.sourceType,
      processing_type: parsed.data.processingType,
      access_strategy: accessStrategyFromProcessingType(parsed.data.processingType),
      priority: parsed.data.priority,
      notes: parsed.data.notes || null,
      selector_config: selectorConfig.value as Json,
      image_domains: imageDomains.value,
      auto_select_classifications: parsed.data.autoSelectClassifications,
      detailed_logging: parsed.data.detailedLogging,
      can_details: parsed.data.canDetails,
      can_availability: parsed.data.canAvailability,
      can_pricing: parsed.data.canPricing,
      can_contact: parsed.data.canContact,
      supports_dates: parsed.data.supportsDates,
      supports_price: parsed.data.supportsPrice,
      supports_guests: parsed.data.supportsGuests,
      contact_capability: parsed.data.contactCapability,
      // Every new source starts unreviewed — `approveSearchSource` is the only path to `enabled`.
      status: "draft",
      enabled: false,
    })
    .select("id")
    .single();
  if (error) return { error: error.code === "23505" ? "domainTaken" : "generic" };

  await replaceSourceCoverageAndPolicies(supabase, source.id, { coverage, policies: policies.value });

  await logAudit(supabase, admin.id, "create_search_source", "search_sources", source.id, {
    domain: parsed.data.domain,
  });

  // Best-effort (docs/CLAUDE_SITEMAP_AI_CRAWLER_RULE.md §3): populates the URL Registry right away so
  // the source is ready to search as soon as it's approved. Never blocks/fails source creation — a
  // sync failure just leaves the registry empty until the next sync.
  await syncSourceUrlRegistry(supabase, { id: source.id, baseUrl: parsed.data.baseUrl });

  revalidatePath(`/${locale}/admin/search-sources`);
  return {};
}

export async function updateSearchSource(
  locale: Locale,
  sourceId: string,
  _prevState: SearchSourceActionState,
  formData: FormData,
): Promise<SearchSourceActionState> {
  const parsed = searchSourceSchema.safeParse({
    name: formData.get("name"),
    domain: formData.get("domain"),
    baseUrl: formData.get("baseUrl"),
    sourceType: formData.get("sourceType"),
    processingType: formData.get("processingType"),
    priority: formData.get("priority"),
    notes: formData.get("notes"),
    // Absent (not just empty) when the form hid this field for the current processingType — the
    // schema's `.default("")` only kicks in for `undefined`, so `null` needs coalescing here too.
    selectorConfig: formData.get("selectorConfig") ?? "",
    imageDomains: formData.get("imageDomains") ?? "",
    autoSelectClassifications: formData.getAll("autoSelectClassifications"),
    detailedLogging: formData.get("detailedLogging"),
    canDetails: formData.get("canDetails"),
    canAvailability: formData.get("canAvailability"),
    canPricing: formData.get("canPricing"),
    canContact: formData.get("canContact"),
    supportsDates: formData.get("supportsDates"),
    supportsPrice: formData.get("supportsPrice"),
    supportsGuests: formData.get("supportsGuests"),
    contactCapability: formData.get("contactCapability") ?? "",
    coverageWorldwide: formData.get("coverageWorldwide"),
    coverageCountry: formData.get("coverageCountry") ?? "",
    coverageRegion: formData.get("coverageRegion") ?? "",
    coverageDestination: formData.get("coverageDestination") ?? "",
    coverageLatitude: formData.get("coverageLatitude") ?? "",
    coverageLongitude: formData.get("coverageLongitude") ?? "",
    coverageRadiusKm: formData.get("coverageRadiusKm") ?? "",
    policies: formData.get("policies") ?? "",
  });
  if (!parsed.success) return { error: "invalid" };

  const selectorConfig = parseSelectorConfig(parsed.data.selectorConfig);
  if (!selectorConfig.ok) return { error: "selectorConfigInvalid" };
  const imageDomains = parseImageDomains(parsed.data.imageDomains);
  if (!imageDomains.ok) return { error: "imageDomainsInvalid" };
  const coverage = parseCoverageInput(parsed.data);
  const policies = parseSourcePolicies(parsed.data.policies);
  if (!policies.ok) return { error: "policiesInvalid" };

  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if ("error" in admin) return { error: admin.error };

  const { data: existing } = await supabase
    .from("search_sources")
    .select("base_url")
    .eq("id", sourceId)
    .maybeSingle();

  // Status/enabled are deliberately not touched here — those go through
  // approveSearchSource/rejectSearchSource/setSearchSourceEnabled, which is where the audit trail
  // for the review lifecycle lives. Editing the registration details doesn't reset a review.
  const { error } = await supabase
    .from("search_sources")
    .update({
      name: parsed.data.name,
      domain: parsed.data.domain,
      base_url: parsed.data.baseUrl,
      source_type: parsed.data.sourceType,
      processing_type: parsed.data.processingType,
      access_strategy: accessStrategyFromProcessingType(parsed.data.processingType),
      priority: parsed.data.priority,
      notes: parsed.data.notes || null,
      selector_config: selectorConfig.value as Json,
      image_domains: imageDomains.value,
      auto_select_classifications: parsed.data.autoSelectClassifications,
      detailed_logging: parsed.data.detailedLogging,
      can_details: parsed.data.canDetails,
      can_availability: parsed.data.canAvailability,
      can_pricing: parsed.data.canPricing,
      can_contact: parsed.data.canContact,
      supports_dates: parsed.data.supportsDates,
      supports_price: parsed.data.supportsPrice,
      supports_guests: parsed.data.supportsGuests,
      contact_capability: parsed.data.contactCapability,
    })
    .eq("id", sourceId);
  if (error) return { error: error.code === "23505" ? "domainTaken" : "generic" };

  await replaceSourceCoverageAndPolicies(supabase, sourceId, { coverage, policies: policies.value });

  await logAudit(supabase, admin.id, "update_search_source", "search_sources", sourceId, {
    domain: parsed.data.domain,
  });

  // Re-sync only when `base_url` itself actually changed — the one edit that can make the existing
  // URL Registry wrong (pointing at a site that's no longer this source's target). Saving any other
  // field (name, priority, notes, processing type, crawl rules live on their own form) must not
  // trigger a live re-crawl that reclassifies/bumps every already-discovered row for no reason; an
  // admin who wants a fresh crawl already has "Resync now" on the URL Registry page for that.
  if (existing && existing.base_url !== parsed.data.baseUrl) {
    await syncSourceUrlRegistry(supabase, { id: sourceId, baseUrl: parsed.data.baseUrl });
  }

  revalidatePath(`/${locale}/admin/search-sources`);
  return redirect({ href: "/admin/search-sources", locale });
}

export interface SetSearchSourceStatusResult {
  error?: "unauthenticated" | "forbidden" | "generic";
}

/** Moves a draft/needs_review source to active and switches it on — the only path that sets
 *  `enabled: true`, so it's always paired with the source having been reviewed. */
export async function approveSearchSource(
  locale: Locale,
  sourceId: string,
): Promise<SetSearchSourceStatusResult> {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if ("error" in admin) return { error: admin.error };

  const { error } = await supabase
    .from("search_sources")
    .update({ status: "active", enabled: true })
    .eq("id", sourceId);
  if (error) return { error: "generic" };

  await logAudit(supabase, admin.id, "approve_search_source", "search_sources", sourceId);

  revalidatePath(`/${locale}/admin/search-sources`);
  return {};
}

export async function rejectSearchSource(
  locale: Locale,
  sourceId: string,
): Promise<SetSearchSourceStatusResult> {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if ("error" in admin) return { error: admin.error };

  const { error } = await supabase
    .from("search_sources")
    .update({ status: "rejected", enabled: false })
    .eq("id", sourceId);
  if (error) return { error: "generic" };

  await logAudit(supabase, admin.id, "reject_search_source", "search_sources", sourceId);

  revalidatePath(`/${locale}/admin/search-sources`);
  return {};
}

export interface SetSearchSourceEnabledResult {
  error?: "unauthenticated" | "forbidden" | "generic";
}

export async function setSearchSourceEnabled(
  locale: Locale,
  sourceId: string,
  enabled: boolean,
): Promise<SetSearchSourceEnabledResult> {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if ("error" in admin) return { error: admin.error };

  const { error } = await supabase.from("search_sources").update({ enabled }).eq("id", sourceId);
  if (error) return { error: "generic" };

  await logAudit(
    supabase,
    admin.id,
    enabled ? "enable_search_source" : "disable_search_source",
    "search_sources",
    sourceId,
  );

  revalidatePath(`/${locale}/admin/search-sources`);
  return {};
}

export async function deleteSearchSource(locale: Locale, sourceId: string): Promise<DeleteResult> {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if ("error" in admin) return { error: admin.error };

  const { error } = await supabase.from("search_sources").delete().eq("id", sourceId);
  if (error) return { error: "generic" };

  await logAudit(supabase, admin.id, "delete_search_source", "search_sources", sourceId);

  revalidatePath(`/${locale}/admin/search-sources`);
  return {};
}

export interface ResyncSearchSourceUrlsResult {
  error?: "unauthenticated" | "forbidden" | "notFound" | "generic";
  discovered?: number;
  truncated?: boolean;
  pruned?: number;
  method?: "sitemap" | "html-crawl" | null;
}

/** Manual "Обновить сейчас" trigger (URL Registry page) — the same full sync
 * `createSearchSource`/`updateSearchSource` run automatically, exposed on demand for a source whose
 * registration details haven't changed but whose live sitemap has. */
export async function resyncSearchSourceUrls(
  locale: Locale,
  sourceId: string,
): Promise<ResyncSearchSourceUrlsResult> {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if ("error" in admin) return { error: admin.error };

  const { data: source, error } = await supabase
    .from("search_sources")
    .select("id, base_url")
    .eq("id", sourceId)
    .maybeSingle();
  if (error) return { error: "generic" };
  if (!source) return { error: "notFound" };

  const summary = await syncSourceUrlRegistry(supabase, { id: source.id, baseUrl: source.base_url });

  await logAudit(supabase, admin.id, "resync_search_source_urls", "search_sources", sourceId, {
    discovered: summary.discovered,
    pruned: summary.pruned,
    method: summary.method,
  });

  revalidatePath(`/${locale}/admin/search-sources/${sourceId}/urls`);
  return {
    discovered: summary.discovered,
    truncated: summary.truncated,
    pruned: summary.pruned,
    method: summary.method,
  };
}

export interface ReindexSearchSourceResult {
  error?: "unauthenticated" | "forbidden" | "notFound" | "generic";
  urlsConsidered?: number;
  listingsIndexed?: number;
  pagesFailed?: number;
  aiCalls?: number;
}

/**
 * Manual "Индексировать сейчас" trigger (URL Registry page, Э5) — the same background walk the
 * `index-sources` cron runs on a schedule, exposed on demand: useful right after approving a new
 * source or editing its `selectorConfig`, rather than waiting for the next scheduled run.
 */
export async function reindexSearchSource(locale: Locale, sourceId: string): Promise<ReindexSearchSourceResult> {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if ("error" in admin) return { error: admin.error };

  const { data: source, error } = await supabase
    .from("search_sources")
    .select("id")
    .eq("id", sourceId)
    .maybeSingle();
  if (error) return { error: "generic" };
  if (!source) return { error: "notFound" };

  const result = await indexSource(sourceId);

  await logAudit(supabase, admin.id, "reindex_search_source", "search_sources", sourceId, {
    urlsConsidered: result.urlsConsidered,
    listingsIndexed: result.listingsIndexed,
  });

  // Э10: `indexSource` (called above) also just recomputed this source's `needs_reanalysis` verdict
  // (`checkSourceStructureHealth`) — the list page's own badge needs revalidating too, not just the
  // URL Registry page this trigger lives on.
  revalidatePath(`/${locale}/admin/search-sources`);
  revalidatePath(`/${locale}/admin/search-sources/${sourceId}/urls`);
  return {
    urlsConsidered: result.urlsConsidered,
    listingsIndexed: result.listingsIndexed,
    pagesFailed: result.pagesFailed,
    aiCalls: result.aiCalls,
  };
}

export interface FetchReindexProgressResult extends AdminReindexProgress {
  error?: "unauthenticated" | "forbidden";
}

/**
 * Client-polled read (`ReindexProgressIndicator`) behind the same admin gate as every other action
 * here — a plain read, not a mutation, but exposed as an action rather than a route handler since
 * the polling component is otherwise a client-only leaf with no server-rendered parent to hand it
 * fresh props on an interval.
 */
export async function fetchReindexProgress(sourceId: string): Promise<FetchReindexProgressResult> {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if ("error" in admin) return { error: admin.error, startedAt: null, finishedAt: null, total: null, processed: null };

  return getSearchSourceReindexProgress(sourceId);
}

export interface AddManualUrlsActionResult {
  error?: "unauthenticated" | "forbidden" | "notFound" | "invalid" | "generic";
  added?: number;
  skipped?: number;
}

/**
 * Manual-entry escape hatch (URL Registry page) for a source `resyncSearchSourceUrls` can't help —
 * no sitemap, and following links from the homepage doesn't reach the detail pages either. An admin
 * pastes the exact URLs; `addManualUrls` (`url-registry-sync.ts`) classifies and stores them exactly
 * like a real sync's discoveries.
 */
export async function addManualSourceUrls(
  locale: Locale,
  sourceId: string,
  _prevState: AddManualUrlsActionResult,
  formData: FormData,
): Promise<AddManualUrlsActionResult> {
  const rawUrls = String(formData.get("urls") ?? "")
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (rawUrls.length === 0) return { error: "invalid" };

  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if ("error" in admin) return { error: admin.error };

  const { data: source, error } = await supabase
    .from("search_sources")
    .select("id, base_url")
    .eq("id", sourceId)
    .maybeSingle();
  if (error) return { error: "generic" };
  if (!source) return { error: "notFound" };

  const result = await addManualUrls(supabase, { id: source.id, baseUrl: source.base_url }, rawUrls);
  if (result.added === 0) return { error: "invalid" };

  await logAudit(supabase, admin.id, "add_manual_source_urls", "search_source_urls", sourceId, {
    added: result.added,
    skipped: result.skipped,
  });

  revalidatePath(`/${locale}/admin/search-sources/${sourceId}/urls`);
  return { added: result.added, skipped: result.skipped };
}

export interface ClearSourceUrlRegistryResult {
  error?: "unauthenticated" | "forbidden" | "notFound" | "generic";
  deleted?: number;
}

/**
 * Wipes every row of a source's URL Registry (URL Registry page's "Clear list" button) — for
 * starting over after a source's `base_url`/sitemap changed shape, or after cleaning up a source
 * that got contaminated some other way `syncSourceUrlRegistry`'s own `pruneForeignUrls` doesn't
 * cover. A resync (or manual add) repopulates it from scratch; nothing else references these rows.
 */
export async function clearSourceUrlRegistry(
  locale: Locale,
  sourceId: string,
): Promise<ClearSourceUrlRegistryResult> {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if ("error" in admin) return { error: admin.error };

  const { data: source, error: sourceError } = await supabase
    .from("search_sources")
    .select("id")
    .eq("id", sourceId)
    .maybeSingle();
  if (sourceError) return { error: "generic" };
  if (!source) return { error: "notFound" };

  const { count } = await supabase
    .from("search_source_urls")
    .select("id", { count: "exact", head: true })
    .eq("source_id", sourceId);

  const { error } = await supabase.from("search_source_urls").delete().eq("source_id", sourceId);
  if (error) return { error: "generic" };

  await logAudit(supabase, admin.id, "clear_search_source_urls", "search_source_urls", sourceId, {
    deleted: count ?? 0,
  });

  revalidatePath(`/${locale}/admin/search-sources/${sourceId}/urls`);
  return { deleted: count ?? 0 };
}

export interface CrawlRuleActionState {
  error?: string;
}

export async function createCrawlRule(
  locale: Locale,
  sourceId: string,
  _prevState: CrawlRuleActionState,
  formData: FormData,
): Promise<CrawlRuleActionState> {
  const parsed = crawlRuleSchema.safeParse({
    pattern: formData.get("pattern"),
    patternType: formData.get("patternType"),
    classification: formData.get("classification"),
    priority: formData.get("priority"),
  });
  if (!parsed.success) return { error: "invalid" };

  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if ("error" in admin) return { error: admin.error };

  const { error } = await supabase.from("search_source_crawl_rules").insert({
    source_id: sourceId,
    pattern: parsed.data.pattern,
    pattern_type: parsed.data.patternType,
    classification: parsed.data.classification,
    priority: parsed.data.priority,
  });
  if (error) return { error: "generic" };

  await logAudit(supabase, admin.id, "create_crawl_rule", "search_source_crawl_rules", sourceId, {
    pattern: parsed.data.pattern,
  });
  await reclassifyStoredUrls(supabase, sourceId);

  revalidatePath(`/${locale}/admin/search-sources/${sourceId}/urls`);
  return {};
}

export async function deleteCrawlRule(
  locale: Locale,
  sourceId: string,
  ruleId: string,
): Promise<DeleteResult> {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if ("error" in admin) return { error: admin.error };

  const { error } = await supabase.from("search_source_crawl_rules").delete().eq("id", ruleId);
  if (error) return { error: "generic" };

  await logAudit(supabase, admin.id, "delete_crawl_rule", "search_source_crawl_rules", ruleId);
  await reclassifyStoredUrls(supabase, sourceId);

  revalidatePath(`/${locale}/admin/search-sources/${sourceId}/urls`);
  return {};
}

/** Bulk variant of `deleteCrawlRule` for the multi-select toolbar — one round-trip and one
 *  `reclassifyStoredUrls` pass for the whole selection instead of one per row. */
export async function deleteCrawlRules(
  locale: Locale,
  sourceId: string,
  ruleIds: string[],
): Promise<DeleteResult> {
  if (ruleIds.length === 0) return {};

  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if ("error" in admin) return { error: admin.error };

  const { error } = await supabase.from("search_source_crawl_rules").delete().in("id", ruleIds);
  if (error) return { error: "generic" };

  await logAudit(supabase, admin.id, "delete_crawl_rules", "search_source_crawl_rules", sourceId, {
    ruleIds,
    count: ruleIds.length,
  });
  await reclassifyStoredUrls(supabase, sourceId);

  revalidatePath(`/${locale}/admin/search-sources/${sourceId}/urls`);
  return {};
}

export interface SetUrlSelectionOverrideResult {
  error?: "unauthenticated" | "forbidden" | "generic";
}

/** Point override for one registry row — "selection by list" alongside "selection by rules". `null`
 *  clears the override and reverts the row to following the source's auto-select rule. */
export async function setUrlSelectionOverride(
  locale: Locale,
  sourceId: string,
  urlRowId: string,
  override: boolean | null,
): Promise<SetUrlSelectionOverrideResult> {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if ("error" in admin) return { error: admin.error };

  const { data: row, error: readError } = await supabase
    .from("search_source_urls")
    .select("classification")
    .eq("id", urlRowId)
    .maybeSingle();
  if (readError || !row) return { error: "generic" };

  const { data: sourceRow } = await supabase
    .from("search_sources")
    .select("auto_select_classifications")
    .eq("id", sourceId)
    .maybeSingle();
  const autoSelect = sourceRow?.auto_select_classifications ?? ["HIGH"];

  const { error } = await supabase
    .from("search_source_urls")
    .update({
      selection_override: override,
      selected: override ?? autoSelect.includes(row.classification),
    })
    .eq("id", urlRowId);
  if (error) return { error: "generic" };

  await logAudit(supabase, admin.id, "set_url_selection_override", "search_source_urls", urlRowId, {
    override,
  });

  revalidatePath(`/${locale}/admin/search-sources/${sourceId}/urls`);
  return {};
}

export interface CrawlRulePreviewState extends Partial<CrawlPreviewResult> {
  error?: "unauthenticated" | "forbidden" | "notFound" | "generic";
}

/**
 * Read-only "what would happen" check for the crawl-rules page — robots.txt rules plus a live
 * sitemap walk classified by the source's currently saved rules, nothing persisted. Lets an admin
 * verify a rule (prefix or regex) against the real site before relying on it, without waiting for a
 * full `resyncSearchSourceUrls`. No audit log entry: this never changes anything, same reasoning as
 * `validateSearchSourceCandidate`.
 */
export async function previewSourceCrawlRules(sourceId: string): Promise<CrawlRulePreviewState> {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if ("error" in admin) return { error: admin.error };

  const { data: source, error } = await supabase
    .from("search_sources")
    .select("id, base_url")
    .eq("id", sourceId)
    .maybeSingle();
  if (error) return { error: "generic" };
  if (!source) return { error: "notFound" };

  try {
    return await previewSourceCrawlClassification(supabase, { id: source.id, baseUrl: source.base_url });
  } catch {
    return { error: "generic" };
  }
}

export interface CreateRulesFromRobotsResult {
  error?: "unauthenticated" | "forbidden" | "notFound" | "noDisallowRules" | "generic";
  created?: number;
  skipped?: number;
}

/**
 * Turns a site's own robots.txt `Disallow` entries (docs/CLAUDE_SITEMAP_AI_CRAWLER_RULE.md §2.1,
 * §4) into SKIP crawl rules — a site that already tells crawlers to stay off `/account/` or
 * `/checkout/` is telling us the same thing our own classifier would otherwise have to be taught by
 * hand. `Allow` entries aren't turned into rules: "allowed to crawl" doesn't map onto any of our
 * classifications (HIGH/MEDIUM/LOW all mean "allowed", just at different priority), so there's
 * nothing non-arbitrary to create from them — they still show up in the preview panel for the admin
 * to read. Patterns that already exist as a rule for this source (by exact string match) are
 * skipped, not duplicated.
 */
export async function createCrawlRulesFromRobots(
  locale: Locale,
  sourceId: string,
): Promise<CreateRulesFromRobotsResult> {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if ("error" in admin) return { error: admin.error };

  const { data: source, error: sourceError } = await supabase
    .from("search_sources")
    .select("id, base_url")
    .eq("id", sourceId)
    .maybeSingle();
  if (sourceError) return { error: "generic" };
  if (!source) return { error: "notFound" };

  let robotsInfo;
  try {
    robotsInfo = await fetchRobotsInfo(source.base_url);
  } catch {
    return { error: "generic" };
  }

  const disallowPaths = robotsInfo.rules.rules.filter((rule) => !rule.allow).map((rule) => rule.path);
  if (disallowPaths.length === 0) return { error: "noDisallowRules" };

  const { data: existingRules } = await supabase
    .from("search_source_crawl_rules")
    .select("pattern")
    .eq("source_id", sourceId);
  const existingPatterns = new Set((existingRules ?? []).map((rule) => rule.pattern));

  const uniqueDisallowPaths = [...new Set(disallowPaths)];
  const toInsert = uniqueDisallowPaths
    .filter((path) => !existingPatterns.has(path))
    .map((path) => ({
      source_id: sourceId,
      pattern: path,
      pattern_type: "PREFIX" as const,
      classification: "SKIP" as const,
      priority: 0,
    }));

  if (toInsert.length === 0) {
    return { created: 0, skipped: uniqueDisallowPaths.length };
  }

  const { error } = await supabase.from("search_source_crawl_rules").insert(toInsert);
  if (error) return { error: "generic" };

  await logAudit(supabase, admin.id, "create_crawl_rules_from_robots", "search_source_crawl_rules", sourceId, {
    created: toInsert.length,
  });
  await reclassifyStoredUrls(supabase, sourceId);

  revalidatePath(`/${locale}/admin/search-sources/${sourceId}/urls`);
  return { created: toInsert.length, skipped: uniqueDisallowPaths.length - toInsert.length };
}

interface ConflictListingRow {
  url: string;
  field_provenance: ListingFieldProvenance;
  name: string | null;
  description: string | null;
  price_minor: number | null;
  currency: string | null;
  guests: number | null;
  cabins: number | null;
  vessel_type_raw: string | null;
  country: string | null;
  city: string | null;
}

/** A precise `Update` can't be *written* through a computed key typed as the general
 *  `ListingFieldName` union — same intersection-of-all-fields limitation as `listing-merge.ts`'s
 *  own doc comment on `mergeExtractedListing`. An exhaustive switch sidesteps it: each branch's
 *  literal key gets the update type it actually has, and losing a case here is a compile error
 *  (`LISTING_FIELDS` is a closed tuple), not a silent runtime gap. */
function buildListingFieldUpdate(
  field: ListingFieldName,
  value: ListingFieldValue,
): Database["public"]["Tables"]["external_vessel_index"]["Update"] {
  switch (field) {
    case "name":
      return { name: value as string | null };
    case "description":
      return { description: value as string | null };
    case "price_minor":
      return { price_minor: value as number | null };
    case "currency":
      return { currency: value as string | null };
    case "guests":
      return { guests: value as number | null };
    case "cabins":
      return { cabins: value as number | null };
    case "vessel_type_raw":
      return { vessel_type_raw: value as string | null };
    case "country":
      return { country: value as string | null };
    case "city":
      return { city: value as string | null };
  }
}

export interface ResolveFieldConflictResult {
  error?: "unauthenticated" | "forbidden" | "notFound" | "stale" | "generic";
}

/**
 * Manual resolution for one `search_field_conflicts` row — the last unfinished piece of P2
 * (docs/data-merger-provenance-design.md §4): until now the only way to close an open conflict was
 * a second, independent crawl confirming one side (`listing-merge.ts`'s `mergeExtractedListing`).
 *
 * "kept_previous" only touches the conflict record — a conflict never overwrites the stored value
 * (see `mergeExtractedListing`), so the listing row already holds the previous value; there is
 * nothing to change there.
 *
 * "kept_new" also writes the disputed field on `external_vessel_index`, with `MANUAL`/1.0
 * provenance (design doc §3.4) — through the service-role client specifically: the migration grants
 * `authenticated` only `select` on that table (an admin's own session can resolve the conflict
 * record itself, per that migration's RLS comment, but never write listing data directly). Guards
 * against a stale conflict: if the field has moved since this conflict was detected (a later
 * extraction already changed or re-disputed it), refuses rather than clobbering whatever superseded
 * this conflict's `new_value`.
 */
export async function resolveFieldConflict(
  locale: Locale,
  sourceId: string,
  conflictId: string,
  resolution: "kept_previous" | "kept_new",
): Promise<ResolveFieldConflictResult> {
  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if ("error" in admin) return { error: admin.error };

  const { data: conflict, error: conflictError } = await supabase
    .from("search_field_conflicts")
    .select("id, listing_id, field, previous_value, new_value, resolved_at")
    .eq("id", conflictId)
    .maybeSingle();
  if (conflictError || !conflict) return { error: "notFound" };
  if (conflict.resolved_at) return {}; // Already resolved (e.g. a second admin tab) — nothing left to do.

  const field = conflict.field as ListingFieldName;
  if (!(LISTING_FIELDS as readonly string[]).includes(field)) return { error: "generic" };

  if (resolution === "kept_new") {
    const adminSupabase = createAdminClient();
    const { data: listing, error: listingError } = await adminSupabase
      .from("external_vessel_index")
      .select(
        "url, name, description, price_minor, currency, guests, cabins, vessel_type_raw, country, city, field_provenance",
      )
      .eq("id", conflict.listing_id)
      .maybeSingle();
    if (listingError || !listing) return { error: "generic" };

    const row = listing as ConflictListingRow;
    const currentValue: ListingFieldValue = row[field];
    if (JSON.stringify(currentValue) !== JSON.stringify(conflict.previous_value)) {
      return { error: "stale" };
    }

    const fieldProvenance: ListingFieldProvenance = { ...row.field_provenance };
    fieldProvenance[field] = {
      source: "MANUAL",
      confidence: 1,
      retrievedAt: new Date().toISOString(),
      sourceUrl: row.url,
    };

    const { error: updateError } = await adminSupabase
      .from("external_vessel_index")
      .update({
        ...buildListingFieldUpdate(field, conflict.new_value as ListingFieldValue),
        field_provenance: fieldProvenance as Json,
      })
      .eq("id", conflict.listing_id);
    if (updateError) return { error: "generic" };
  }

  const { error: resolveError } = await supabase
    .from("search_field_conflicts")
    .update({ resolved_at: new Date().toISOString(), resolution })
    .eq("id", conflictId);
  if (resolveError) return { error: "generic" };

  await logAudit(supabase, admin.id, "resolve_field_conflict", "search_field_conflicts", conflictId, {
    field: conflict.field,
    resolution,
  });

  revalidatePath(`/${locale}/admin/search-sources/${sourceId}/urls`);
  return {};
}
