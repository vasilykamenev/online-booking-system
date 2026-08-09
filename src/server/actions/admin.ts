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
  type userRoleValues,
} from "@/lib/validation/admin";

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
    latitude: data.latitude ?? null,
    longitude: data.longitude ?? null,
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
