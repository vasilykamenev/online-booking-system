"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";
import {
  updateUserRoleSchema,
  locationSchema,
  amenityKeySchema,
  commissionRateSchema,
  searchSourceSchema,
  crawlRuleSchema,
  parseSelectorConfig,
  parseImageDomains,
  type userRoleValues,
} from "@/lib/validation/admin";
import {
  validateSearchSource,
  type SourceValidationReport,
} from "@/server/search/source-validation";
import {
  syncSourceUrlRegistry,
  reclassifyStoredUrls,
  previewSourceCrawlClassification,
  type CrawlPreviewResult,
} from "@/server/search/registry/url-registry-sync";
import { fetchRobotsInfo } from "@/server/search/crawl/robots";

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

export interface SearchSourceActionState {
  error?: string;
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
  });
  if (!parsed.success) return { error: "invalid" };

  const selectorConfig = parseSelectorConfig(parsed.data.selectorConfig);
  if (!selectorConfig.ok) return { error: "selectorConfigInvalid" };
  const imageDomains = parseImageDomains(parsed.data.imageDomains);
  if (!imageDomains.ok) return { error: "imageDomainsInvalid" };

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
      priority: parsed.data.priority,
      notes: parsed.data.notes || null,
      selector_config: selectorConfig.value as Json,
      image_domains: imageDomains.value,
      auto_select_classifications: parsed.data.autoSelectClassifications,
      // Every new source starts unreviewed — `approveSearchSource` is the only path to `enabled`.
      status: "draft",
      enabled: false,
    })
    .select("id")
    .single();
  if (error) return { error: error.code === "23505" ? "domainTaken" : "generic" };

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
  });
  if (!parsed.success) return { error: "invalid" };

  const selectorConfig = parseSelectorConfig(parsed.data.selectorConfig);
  if (!selectorConfig.ok) return { error: "selectorConfigInvalid" };
  const imageDomains = parseImageDomains(parsed.data.imageDomains);
  if (!imageDomains.ok) return { error: "imageDomainsInvalid" };

  const supabase = await createClient();
  const admin = await requireAdmin(supabase);
  if ("error" in admin) return { error: admin.error };

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
      priority: parsed.data.priority,
      notes: parsed.data.notes || null,
      selector_config: selectorConfig.value as Json,
      image_domains: imageDomains.value,
      auto_select_classifications: parsed.data.autoSelectClassifications,
    })
    .eq("id", sourceId);
  if (error) return { error: error.code === "23505" ? "domainTaken" : "generic" };

  await logAudit(supabase, admin.id, "update_search_source", "search_sources", sourceId, {
    domain: parsed.data.domain,
  });

  // Best-effort re-sync (domain/baseUrl/rules may have changed) — same reasoning as
  // createSearchSource, never blocks the edit itself.
  await syncSourceUrlRegistry(supabase, { id: sourceId, baseUrl: parsed.data.baseUrl });

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
  });

  revalidatePath(`/${locale}/admin/search-sources/${sourceId}/urls`);
  return { discovered: summary.discovered, truncated: summary.truncated };
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
