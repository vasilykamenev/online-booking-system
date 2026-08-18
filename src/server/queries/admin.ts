import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";
import type { Locale } from "@/i18n/routing";
import { pickLocalized } from "@/lib/supabase/localized";
import { throwIfSupabaseError } from "@/lib/supabase/errors";
import { DEFAULT_PLATFORM_COMMISSION_RATE } from "@/lib/pricing/commission";
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
