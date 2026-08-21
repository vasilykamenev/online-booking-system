import { z } from "zod";
import type { Database } from "@/lib/supabase/database.types";
import { vesselTypeValues } from "@/lib/validation/search";

export const vesselStatusValues = [
  "draft",
  "published",
  "archived",
] as const satisfies readonly Database["public"]["Enums"]["vessel_status"][];

const emptyStringToUndefined = (value: unknown) => (value === "" ? undefined : value);

export const vesselSchema = z
  .object({
    name: z.string().trim().min(2).max(200),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "invalidSlug"),
    type: z.enum(vesselTypeValues),
    // Either an existing catalog entry, or a brand-new location (name + pin) the
    // owner types in — see `newLocationName` below and the refine() at the bottom.
    locationId: z.preprocess(emptyStringToUndefined, z.guid().optional()),
    newLocationName: z.preprocess(
      emptyStringToUndefined,
      z.string().trim().min(1).max(200).optional(),
    ),
    descriptionRu: z.string().trim().max(4000).default(""),
    descriptionEn: z.string().trim().max(4000).default(""),
    lengthMeters: z.coerce.number().positive().max(999.9),
    cabins: z.coerce.number().int().min(0).max(100),
    guestsCapacity: z.coerce.number().int().min(1).max(500),
    yearBuilt: z.preprocess(
      emptyStringToUndefined,
      z.coerce.number().int().min(1900).max(2100).optional(),
    ),
    // Entered in major currency units (e.g. "450.00"); converted to minor units before it hits the DB.
    basePrice: z.coerce.number().positive().max(10_000_000),
    currency: z.string().trim().toUpperCase().length(3),
    status: z.enum(vesselStatusValues),
    // Owner-set pin. When `locationId` is set, this only refines that location's
    // default marina/city point (falls back to `locations.latitude/longitude` when
    // unset — see VesselDetail). When `locationId` is absent, this is the point
    // used to geocode and create the new `locations` row (required in that case).
    latitude: z.preprocess(
      (value) => (value === "" || value == null ? undefined : value),
      z.coerce.number().min(-90).max(90).optional(),
    ),
    longitude: z.preprocess(
      (value) => (value === "" || value == null ? undefined : value),
      z.coerce.number().min(-180).max(180).optional(),
    ),
  })
  .refine(
    (data) =>
      Boolean(data.locationId) ||
      Boolean(data.newLocationName && data.latitude != null && data.longitude != null),
    { message: "invalid", path: ["locationId"] },
  );
export type VesselInput = z.infer<typeof vesselSchema>;

// Raw upload ceiling before server-side compression (src/lib/images/optimize.ts) — a generous
// bound on the original camera/phone file, not the stored size. Enforced by the browser (accept
// attribute + this constant) and by the `vessel-images` storage bucket's own file_size_limit
// (supabase/migrations/20260821090001_vessel_images_raw_staging.sql) — the original file never
// passes through a Server Action, so there's nothing here to check it against server-side.
export const vesselImageMaxBytes = 20 * 1024 * 1024;
export const vesselImageAllowedTypes = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
] as const;

// Total photos per vessel (1 main + up to 9 additional), enforced client- and server-side.
export const vesselImageMaxCount = 10;

// `{vesselId}/raw/{name-slug}-{timestampHash}{random}.{ext}` — see vesselImageRawPath
// (src/lib/images/vessel-image-path.ts) and the storage bucket's RLS policies. Just a shape
// check; real authorization is the storage/DB RLS.
const rawImagePath = z
  .string()
  .regex(/^[0-9a-f-]{36}\/raw\/[a-z0-9-]+\.(jpg|png|webp|avif)$/i, { message: "invalid" });

export const vesselImageSchema = z.object({
  vesselId: z.guid(),
  vesselName: z.string().trim().min(1).max(200),
  rawPath: rawImagePath,
  altTextRu: z.string().trim().max(300).default(""),
  altTextEn: z.string().trim().max(300).default(""),
});
export type VesselImageInput = z.infer<typeof vesselImageSchema>;
