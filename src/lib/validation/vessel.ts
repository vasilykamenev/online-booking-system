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
  descriptionRu: z.string().trim().max(4000).default(""),
  descriptionEn: z.string().trim().max(4000).default(""),
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
  // Optional owner-set pin that refines the location's default marina/city point
  // (falls back to `locations.latitude/longitude` when unset — see VesselDetail).
  latitude: z.preprocess(
    (value) => (value === "" || value == null ? undefined : value),
    z.coerce.number().min(-90).max(90).optional(),
  ),
  longitude: z.preprocess(
    (value) => (value === "" || value == null ? undefined : value),
    z.coerce.number().min(-180).max(180).optional(),
  ),
});
export type VesselInput = z.infer<typeof vesselSchema>;

// Raw upload ceiling before server-side compression (src/lib/images/optimize.ts)
// — a generous bound on the original camera/phone file, not the stored size.
// Guards decode time/memory in the server action, not final storage footprint.
export const vesselImageMaxBytes = 20 * 1024 * 1024;
export const vesselImageAllowedTypes = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
] as const;

export const vesselImageSchema = z.object({
  vesselId: z.guid(),
  file: z
    .instanceof(File, { message: "invalid" })
    .refine((file) => file.size > 0, { message: "invalid" })
    .refine((file) => file.size <= vesselImageMaxBytes, { message: "tooLarge" })
    .refine((file) => vesselImageAllowedTypes.includes(file.type as never), {
      message: "invalidType",
    }),
  altTextRu: z.string().trim().max(300).default(""),
  altTextEn: z.string().trim().max(300).default(""),
});
export type VesselImageInput = z.infer<typeof vesselImageSchema>;
