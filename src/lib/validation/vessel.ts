import { z } from "zod";
import type { Database } from "@/lib/supabase/database.types";
import { vesselTypeValues } from "@/lib/validation/search";

export const vesselStatusValues = [
  "draft",
  "published",
  "archived",
] as const satisfies readonly Database["public"]["Enums"]["vessel_status"][];

export const vesselSchema = z.object({
  name: z.string().trim().min(2).max(200),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "invalidSlug"),
  type: z.enum(vesselTypeValues),
  locationId: z.guid(),
  description: z.string().trim().max(4000).default(""),
  lengthMeters: z.coerce.number().positive().max(999.9),
  cabins: z.coerce.number().int().min(0).max(100),
  guestsCapacity: z.coerce.number().int().min(1).max(500),
  yearBuilt: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.coerce.number().int().min(1900).max(2100).optional(),
  ),
  // Entered in major currency units (e.g. "450.00"); converted to minor units before it hits the DB.
  basePrice: z.coerce.number().positive().max(10_000_000),
  currency: z.string().trim().toUpperCase().length(3),
  status: z.enum(vesselStatusValues),
});
export type VesselInput = z.infer<typeof vesselSchema>;

export const vesselImageSchema = z.object({
  vesselId: z.guid(),
  url: z.string().trim().min(1).max(2000),
  altTextRu: z.string().trim().max(300).default(""),
  altTextEn: z.string().trim().max(300).default(""),
});
export type VesselImageInput = z.infer<typeof vesselImageSchema>;
