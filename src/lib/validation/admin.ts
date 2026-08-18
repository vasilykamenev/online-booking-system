import { z } from "zod";
import type { Database } from "@/lib/supabase/database.types";

export const userRoleValues = [
  "client",
  "owner",
  "admin",
] as const satisfies readonly Database["public"]["Enums"]["user_role"][];

export const updateUserRoleSchema = z.object({
  userId: z.guid(),
  role: z.enum(userRoleValues),
});
export type UpdateUserRoleInput = z.infer<typeof updateUserRoleSchema>;

export const locationSchema = z.object({
  countryRu: z.string().trim().min(1).max(200),
  countryEn: z.string().trim().min(1).max(200),
  cityRu: z.string().trim().min(1).max(200),
  cityEn: z.string().trim().min(1).max(200),
  marinaRu: z.string().trim().max(200).default(""),
  marinaEn: z.string().trim().max(200).default(""),
  // Required: every location needs a point so vessels/initiatives that don't
  // set their own pin can still fall back to the marina's default location
  // on the map (see supabase/migrations/20260817120001_geo_coordinates.sql).
  latitude: z.preprocess(
    (value) => (typeof value === "string" && value.trim() !== "" ? Number(value) : value),
    z.number().min(-90).max(90),
  ),
  longitude: z.preprocess(
    (value) => (typeof value === "string" && value.trim() !== "" ? Number(value) : value),
    z.number().min(-180).max(180),
  ),
});
export type LocationInput = z.infer<typeof locationSchema>;

export const amenityKeySchema = z.object({
  key: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/, "invalidKey"),
});
export type AmenityKeyInput = z.infer<typeof amenityKeySchema>;

// Entered as a whole percentage (e.g. "12" for 12%), stored as a 0-1 fraction.
export const commissionRateSchema = z.object({
  ratePercent: z.coerce.number().min(0).max(100),
});
export type CommissionRateInput = z.infer<typeof commissionRateSchema>;
