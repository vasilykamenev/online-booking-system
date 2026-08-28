import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";
import type { Locale } from "@/i18n/routing";
import { pickLocalized } from "@/lib/supabase/localized";
import { throwIfSupabaseError } from "@/lib/supabase/errors";
import { DEFAULT_PLATFORM_COMMISSION_RATE } from "@/lib/pricing/commission";
import {
  selectorConfigSchema,
  type SelectorConfig,
  type SourcePoliciesInput,
} from "@/lib/validation/admin";
import type { LocalizedText } from "./vessels";

/** Accepts an existing client (e.g. the admin/service-role one already in scope
 * at a payment call site) to avoid an extra round-trip client creation. */
export async function getPlatformCommissionRate(
  client?: SupabaseClient<Database>,
): Promise<number> {
  const supabase = client ?? (await createClient());

  const { data, error } = await supabase
    .from("platform_settings")
    .select("commission_rate")
    .eq("id", true)
    .maybeSingle();

  throwIfSupabaseError(error);
  return data?.commission_rate ?? DEFAULT_PLATFORM_COMMISSION_RATE;
}

/** `platform_settings` is admin-only under RLS, but the rate itself isn't secret — any
 * paying client needs to see it in the pre-payment fee disclosure, so this reads it
 * through the service-role client on purpose. */
export async function getPublicCommissionRate(): Promise<number> {
  return getPlatformCommissionRate(createAdminClient());
}

export interface AdminProfile {
  id: string;
  email: string | null;
  fullName: string | null;
  role: Database["public"]["Enums"]["user_role"];
  createdAt: string;
}

/** Email lives in `auth.users`, not `public.profiles` — merged in via the admin
 * auth API (the only way to list it; PostgREST never exposes `auth.users`). */
export async function getAllProfiles(): Promise<AdminProfile[]> {
  const supabase = await createClient();

  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("id, full_name, role, created_at")
    .order("created_at", { ascending: false });
  throwIfSupabaseError(error);

  const admin = createAdminClient();
  const { data: usersPage, error: usersError } = await admin.auth.admin.listUsers({
    perPage: 1000,
  });
  throwIfSupabaseError(usersError);
  const emailById = new Map(usersPage.users.map((user) => [user.id, user.email ?? null]));

  return (profiles ?? []).map((profile) => ({
    id: profile.id,
    email: emailById.get(profile.id) ?? null,
    fullName: profile.full_name,
    role: profile.role,
    createdAt: profile.created_at,
  }));
}

export interface AdminLocation {
  id: string;
  country: LocalizedText;
  city: LocalizedText;
  marina: LocalizedText | null;
  latitude: number | null;
  longitude: number | null;
}

export async function getAllLocationsAdmin(): Promise<AdminLocation[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("locations")
    .select("id, country, city, marina, latitude, longitude")
    .order("created_at", { ascending: false });

  throwIfSupabaseError(error);

  return (data ?? []).map((location) => ({
    id: location.id,
    country: (location.country ?? {}) as LocalizedText,
    city: (location.city ?? {}) as LocalizedText,
    marina: (location.marina ?? null) as LocalizedText | null,
    latitude: location.latitude,
    longitude: location.longitude,
  }));
}

export async function getLocationById(id: string): Promise<AdminLocation | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("locations")
    .select("id, country, city, marina, latitude, longitude")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    if (error.code === "22P02") return null;
    throw error;
  }
  if (!data) return null;

  return {
    id: data.id,
    country: (data.country ?? {}) as LocalizedText,
    city: (data.city ?? {}) as LocalizedText,
    marina: (data.marina ?? null) as LocalizedText | null,
    latitude: data.latitude,
    longitude: data.longitude,
  };
}

export interface AdminAmenity {
  id: string;
  key: string;
}

export async function getAllAmenitiesAdmin(): Promise<AdminAmenity[]> {
  const supabase = await createClient();

  const { data, error } = await supabase.from("amenities").select("id, key").order("key");
  throwIfSupabaseError(error);
  return data ?? [];
}

export interface AdminSearchSource {
  id: string;
  name: string;
  domain: string;
  baseUrl: string;
  enabled: boolean;
  status: Database["public"]["Enums"]["search_source_status"];
  sourceType: Database["public"]["Enums"]["search_source_type"];
  processingType: Database["public"]["Enums"]["search_processing_type"];
  priority: number;
  reliabilityScore: number | null;
  robotsAllows: boolean | null;
  lastCheckedAt: string | null;
  selectorConfig: SelectorConfig | null;
  imageDomains: string[];
  autoSelectClassifications: Database["public"]["Enums"]["search_url_classification"][];
  notes: string | null;
  createdAt: string;
  detailedLogging: boolean;
  canDetails: boolean;
  canAvailability: boolean;
  canPricing: boolean;
  canContact: boolean;
  supportsDates: boolean;
  supportsPrice: boolean;
  supportsGuests: boolean;
  contactCapability: Database["public"]["Enums"]["search_contact_capability"] | null;
  /** First (and, today, only — see `parseCoverageInput`'s doc comment) coverage row, or `null` when
   *  none is configured yet. */
  coverage: {
    worldwide: boolean;
    country: string | null;
    region: string | null;
    destination: string | null;
    latitude: number | null;
    longitude: number | null;
    radiusKm: number | null;
  } | null;
  policies: SourcePoliciesInput | null;
}

const SEARCH_SOURCE_COLUMNS =
  "id, name, domain, base_url, enabled, status, source_type, processing_type, priority, reliability_score, robots_allows, last_checked_at, selector_config, image_domains, auto_select_classifications, notes, created_at, detailed_logging, can_details, can_availability, can_pricing, can_contact, supports_dates, supports_price, supports_guests, contact_capability, search_source_coverage(worldwide, country, region, destination, latitude, longitude, radius_km), search_source_policies(access_policy, cache_policy, attribution_policy, rate_limit_policy, retention_policy)";

/** Same defensively-null-on-failure convention as `parseAdminSelectorConfig` below. */
function parseAdminSourcePolicies(raw: {
  access_policy: unknown;
  cache_policy: unknown;
  attribution_policy: unknown;
  rate_limit_policy: unknown;
  retention_policy: unknown;
} | null): SourcePoliciesInput | null {
  if (!raw) return null;
  return {
    accessPolicy: (raw.access_policy as Record<string, unknown>) ?? {},
    cachePolicy: (raw.cache_policy as Record<string, unknown>) ?? {},
    attributionPolicy: (raw.attribution_policy as Record<string, unknown>) ?? {},
    rateLimitPolicy: (raw.rate_limit_policy as Record<string, unknown>) ?? {},
    retentionPolicy: (raw.retention_policy as Record<string, unknown>) ?? {},
  };
}

/** Parses `selector_config` the same defensively-null-on-failure way `listEnabledSources`
 *  (`source-registry.ts`) does — an admin-authored value should always be valid (the form validates
 *  it before saving), but the admin UI must not crash on a row saved before this validation existed. */
function parseAdminSelectorConfig(raw: unknown): SelectorConfig | null {
  const result = selectorConfigSchema.safeParse(raw);
  return result.success ? result.data : null;
}

/** Every row, enabled or not — unlike `listEnabledSources` (spec §8's search-time read), the admin
 * view needs disabled/draft/rejected sources too so they can be reviewed or re-enabled. */
export async function getAllSearchSourcesAdmin(): Promise<AdminSearchSource[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("search_sources")
    .select(SEARCH_SOURCE_COLUMNS)
    .order("priority", { ascending: false });

  throwIfSupabaseError(error);

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    domain: row.domain,
    baseUrl: row.base_url,
    enabled: row.enabled,
    status: row.status,
    sourceType: row.source_type,
    processingType: row.processing_type,
    priority: row.priority,
    reliabilityScore: row.reliability_score,
    robotsAllows: row.robots_allows,
    lastCheckedAt: row.last_checked_at,
    selectorConfig: parseAdminSelectorConfig(row.selector_config),
    imageDomains: row.image_domains,
    autoSelectClassifications: row.auto_select_classifications,
    notes: row.notes,
    createdAt: row.created_at,
    detailedLogging: row.detailed_logging,
    canDetails: row.can_details,
    canAvailability: row.can_availability,
    canPricing: row.can_pricing,
    canContact: row.can_contact,
    supportsDates: row.supports_dates,
    supportsPrice: row.supports_price,
    supportsGuests: row.supports_guests,
    contactCapability: row.contact_capability,
    coverage: row.search_source_coverage?.[0]
      ? {
          worldwide: row.search_source_coverage[0].worldwide,
          country: row.search_source_coverage[0].country,
          region: row.search_source_coverage[0].region,
          destination: row.search_source_coverage[0].destination,
          latitude: row.search_source_coverage[0].latitude,
          longitude: row.search_source_coverage[0].longitude,
          radiusKm: row.search_source_coverage[0].radius_km,
        }
      : null,
    policies: parseAdminSourcePolicies(row.search_source_policies),
  }));
}

export async function getSearchSourceById(id: string): Promise<AdminSearchSource | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("search_sources")
    .select(SEARCH_SOURCE_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    if (error.code === "22P02") return null; // Malformed UUID in the URL.
    throw error;
  }
  if (!data) return null;

  return {
    id: data.id,
    name: data.name,
    domain: data.domain,
    baseUrl: data.base_url,
    enabled: data.enabled,
    status: data.status,
    sourceType: data.source_type,
    processingType: data.processing_type,
    priority: data.priority,
    reliabilityScore: data.reliability_score,
    robotsAllows: data.robots_allows,
    lastCheckedAt: data.last_checked_at,
    selectorConfig: parseAdminSelectorConfig(data.selector_config),
    imageDomains: data.image_domains,
    autoSelectClassifications: data.auto_select_classifications,
    notes: data.notes,
    createdAt: data.created_at,
    detailedLogging: data.detailed_logging,
    canDetails: data.can_details,
    canAvailability: data.can_availability,
    canPricing: data.can_pricing,
    canContact: data.can_contact,
    supportsDates: data.supports_dates,
    supportsPrice: data.supports_price,
    supportsGuests: data.supports_guests,
    contactCapability: data.contact_capability,
    coverage: data.search_source_coverage?.[0]
      ? {
          worldwide: data.search_source_coverage[0].worldwide,
          country: data.search_source_coverage[0].country,
          region: data.search_source_coverage[0].region,
          destination: data.search_source_coverage[0].destination,
          latitude: data.search_source_coverage[0].latitude,
          longitude: data.search_source_coverage[0].longitude,
          radiusKm: data.search_source_coverage[0].radius_km,
        }
      : null,
    policies: parseAdminSourcePolicies(data.search_source_policies),
  };
}

export interface AdminCrawlRule {
  id: string;
  pattern: string;
  patternType: Database["public"]["Enums"]["search_crawl_rule_pattern_type"];
  classification: Database["public"]["Enums"]["search_url_classification"];
  priority: number;
  enabled: boolean;
}

export async function getCrawlRules(sourceId: string): Promise<AdminCrawlRule[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("search_source_crawl_rules")
    .select("id, pattern, pattern_type, classification, priority, enabled")
    .eq("source_id", sourceId)
    .order("priority", { ascending: false });

  throwIfSupabaseError(error);
  return (data ?? []).map((row) => ({
    id: row.id,
    pattern: row.pattern,
    patternType: row.pattern_type,
    classification: row.classification,
    priority: row.priority,
    enabled: row.enabled,
  }));
}

export interface AdminUrlRegistryRow {
  id: string;
  url: string;
  classification: Database["public"]["Enums"]["search_url_classification"];
  priority: number;
  selected: boolean;
  selectionOverride: boolean | null;
  crawlStatus: Database["public"]["Enums"]["search_url_crawl_status"];
  lastFetchedAt: string | null;
  lastSeenAt: string;
}

/** Capped — a large catalog's registry can run into the thousands of rows; this is a review list
 *  for an admin, not a paginated data table (yet). */
const URL_REGISTRY_PAGE_LIMIT = 300;

export async function getSourceUrlRegistry(sourceId: string): Promise<AdminUrlRegistryRow[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("search_source_urls")
    .select("id, url, classification, priority, selected, selection_override, crawl_status, last_fetched_at, last_seen_at")
    .eq("source_id", sourceId)
    .order("classification", { ascending: true })
    .order("priority", { ascending: false })
    .limit(URL_REGISTRY_PAGE_LIMIT);

  throwIfSupabaseError(error);

  return (data ?? []).map((row) => ({
    id: row.id,
    url: row.url,
    classification: row.classification,
    priority: row.priority,
    selected: row.selected,
    selectionOverride: row.selection_override,
    crawlStatus: row.crawl_status,
    lastFetchedAt: row.last_fetched_at,
    lastSeenAt: row.last_seen_at,
  }));
}

export type SourceUrlCounts = Record<
  Database["public"]["Enums"]["search_url_classification"],
  { total: number; selected: number }
>;

export async function getSourceUrlCounts(sourceId: string): Promise<SourceUrlCounts> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("search_source_urls")
    .select("classification, selected")
    .eq("source_id", sourceId);

  throwIfSupabaseError(error);

  const counts: SourceUrlCounts = {
    HIGH: { total: 0, selected: 0 },
    MEDIUM: { total: 0, selected: 0 },
    LOW: { total: 0, selected: 0 },
    SKIP: { total: 0, selected: 0 },
  };
  for (const row of data ?? []) {
    counts[row.classification].total += 1;
    if (row.selected) counts[row.classification].selected += 1;
  }
  return counts;
}

export interface AdminFieldConflict {
  id: string;
  url: string;
  field: string;
  previousValue: unknown;
  newValue: unknown;
  previousSource: Database["public"]["Enums"]["search_field_source"];
  newSource: Database["public"]["Enums"]["search_field_source"];
  detectedAt: string;
}

// Review list for an admin, same reasoning/cap as `URL_REGISTRY_PAGE_LIMIT` above.
const OPEN_CONFLICTS_LIMIT = 200;

/** Open (unresolved) `search_field_conflicts` for a source (docs/data-merger-provenance-design.md §3.3,
 *  phase P2) — a field the extraction cascade re-derived and got a different answer for than what's
 *  already stored in `external_vessel_index`, still unconfirmed by a second crawl. Two queries
 *  rather than one embedded select: filtering conflicts by their parent listing's `source_id` through
 *  PostgREST's embedded-resource syntax needs an inner join filter that's more fragile to keep in sync
 *  with schema changes than just fetching this source's listing ids first. */
export async function getOpenFieldConflicts(sourceId: string): Promise<AdminFieldConflict[]> {
  const supabase = await createClient();

  const { data: listings, error: listingsError } = await supabase
    .from("external_vessel_index")
    .select("id, url")
    .eq("source_id", sourceId);
  throwIfSupabaseError(listingsError);
  if (!listings || listings.length === 0) return [];

  const urlByListingId = new Map(listings.map((row) => [row.id, row.url]));
  const { data: conflicts, error: conflictsError } = await supabase
    .from("search_field_conflicts")
    .select("id, listing_id, field, previous_value, new_value, previous_source, new_source, detected_at")
    .in(
      "listing_id",
      listings.map((row) => row.id),
    )
    .is("resolved_at", null)
    .order("detected_at", { ascending: false })
    .limit(OPEN_CONFLICTS_LIMIT);
  throwIfSupabaseError(conflictsError);

  return (conflicts ?? []).map((row) => ({
    id: row.id,
    url: urlByListingId.get(row.listing_id) ?? "",
    field: row.field,
    previousValue: row.previous_value,
    newValue: row.new_value,
    previousSource: row.previous_source,
    newSource: row.new_source,
    detectedAt: row.detected_at,
  }));
}

export interface AdminAuditLogEntry {
  id: string;
  adminName: string | null;
  action: string;
  targetTable: string;
  targetId: string | null;
  meta: unknown;
  createdAt: string;
}

export async function getAuditLog(limit = 100): Promise<AdminAuditLogEntry[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("audit_log")
    .select("id, action, target_table, target_id, meta, created_at, profiles ( full_name )")
    .order("created_at", { ascending: false })
    .limit(limit);

  throwIfSupabaseError(error);

  return (data ?? []).map((entry) => ({
    id: entry.id,
    adminName: entry.profiles?.full_name ?? null,
    action: entry.action,
    targetTable: entry.target_table,
    targetId: entry.target_id,
    meta: entry.meta,
    createdAt: entry.created_at,
  }));
}

export interface AdminOverview {
  totalBookings: number;
  bookingsByStatus: Record<Database["public"]["Enums"]["booking_status"], number>;
  cancellationRate: number;
  revenueByCurrency: Record<string, number>;
  averagePriceByCurrency: Record<string, number>;
  topDestinations: { locationId: string; label: string; bookingsCount: number }[];
  topVessels: { vesselId: string; name: string; bookingsCount: number }[];
}

/**
 * BRD §10 reports: bookings, revenue, destinations, vessels, cancellations, average
 * price. Aggregated in JS over a bounded row set — fine at this scale; would move to
 * SQL views/materialized aggregates if the bookings table grows large.
 */
export async function getAdminOverview(locale: Locale): Promise<AdminOverview> {
  const supabase = await createClient();

  const { data: bookings, error: bookingsError } = await supabase
    .from("bookings")
    .select(
      `id, status, price_minor, currency, vessel_id,
       vessels ( name, location_id, locations ( country, city ) )`,
    );
  throwIfSupabaseError(bookingsError);

  const rows = bookings ?? [];
  const bookingsByStatus = {
    pending: 0,
    confirmed: 0,
    paid: 0,
    cancelled: 0,
    completed: 0,
  } as Record<Database["public"]["Enums"]["booking_status"], number>;

  const revenueByCurrency: Record<string, number> = {};
  const priceSumByCurrency: Record<string, number> = {};
  const priceCountByCurrency: Record<string, number> = {};
  const destinationCounts = new Map<string, { label: string; count: number }>();
  const vesselCounts = new Map<string, { name: string; count: number }>();

  for (const booking of rows) {
    bookingsByStatus[booking.status] += 1;
    if (booking.status === "cancelled") continue;

    revenueByCurrency[booking.currency] =
      (revenueByCurrency[booking.currency] ?? 0) +
      (booking.status === "paid" || booking.status === "completed" ? booking.price_minor : 0);
    priceSumByCurrency[booking.currency] = (priceSumByCurrency[booking.currency] ?? 0) + booking.price_minor;
    priceCountByCurrency[booking.currency] = (priceCountByCurrency[booking.currency] ?? 0) + 1;

    const location = booking.vessels?.locations;
    if (location) {
      const country = pickLocalized(location.country as LocalizedText, locale);
      const city = pickLocalized(location.city as LocalizedText, locale);
      const label = [city, country].filter(Boolean).join(", ");
      const key = booking.vessels?.location_id ?? label;
      const existing = destinationCounts.get(key);
      destinationCounts.set(key, { label, count: (existing?.count ?? 0) + 1 });
    }

    if (booking.vessel_id) {
      const existing = vesselCounts.get(booking.vessel_id);
      vesselCounts.set(booking.vessel_id, {
        name: booking.vessels?.name ?? "",
        count: (existing?.count ?? 0) + 1,
      });
    }
  }

  const averagePriceByCurrency: Record<string, number> = {};
  for (const currency of Object.keys(priceSumByCurrency)) {
    averagePriceByCurrency[currency] = Math.round(
      priceSumByCurrency[currency] / priceCountByCurrency[currency],
    );
  }

  const totalBookings = rows.length;
  const cancellationRate = totalBookings === 0 ? 0 : bookingsByStatus.cancelled / totalBookings;

  const topDestinations = [...destinationCounts.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5)
    .map(([locationId, value]) => ({
      locationId,
      label: value.label,
      bookingsCount: value.count,
    }));

  const topVessels = [...vesselCounts.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5)
    .map(([vesselId, value]) => ({ vesselId, name: value.name, bookingsCount: value.count }));

  return {
    totalBookings,
    bookingsByStatus,
    cancellationRate,
    revenueByCurrency,
    averagePriceByCurrency,
    topDestinations,
    topVessels,
  };
}

export interface AdminPaymentEntry {
  id: string;
  bookingId: string;
  vesselName: string;
  payerName: string | null;
  payeeName: string | null;
  provider: Database["public"]["Enums"]["payment_provider"];
  status: Database["public"]["Enums"]["payment_status"];
  amountMinor: number;
  currency: string;
  platformFeeMinor: number;
  failureReason: string | null;
  externalReference: string | null;
  createdAt: string;
}

/** Every payment attempt (success and failure), platform-wide — the admin-facing audit
 * trail (CLAUDE.md §9 admin oversight). `payments_read` already grants admins full read
 * via `is_admin()`, so the caller's own session client is enough — no service role needed. */
export async function getAllPaymentsAdmin(limit = 200): Promise<AdminPaymentEntry[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("payments")
    .select(
      `id, booking_id, provider, status, amount_minor, currency, platform_fee_minor,
       failure_reason, external_reference, created_at,
       payer:profiles!payments_payer_id_fkey ( full_name ),
       payee:profiles!payments_payee_id_fkey ( full_name ),
       bookings ( vessels ( name ) )`,
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  throwIfSupabaseError(error);

  return (data ?? []).map((payment) => ({
    id: payment.id,
    bookingId: payment.booking_id,
    vesselName: payment.bookings?.vessels?.name ?? "",
    payerName: payment.payer?.full_name ?? null,
    payeeName: payment.payee?.full_name ?? null,
    provider: payment.provider,
    status: payment.status,
    amountMinor: payment.amount_minor,
    currency: payment.currency,
    platformFeeMinor: payment.platform_fee_minor,
    failureReason: payment.failure_reason,
    externalReference: payment.external_reference,
    createdAt: payment.created_at,
  }));
}
