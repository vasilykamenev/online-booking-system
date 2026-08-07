import { z } from "zod";
import type { Database } from "@/lib/supabase/database.types";

export const vesselTypeValues = [
  "yacht",
  "catamaran",
  "expedition",
  "research",
  "hybrid",
] as const satisfies readonly Database["public"]["Enums"]["vessel_type"][];

/** Empty strings come from cleared number inputs and must mean "no filter", not 0. */
const emptyToUndefined = (value: unknown) => (value === "" ? undefined : value);

export const searchParamsSchema = z.object({
  type: z.enum(vesselTypeValues).optional(),
  location: z.uuid().optional(),
  guests: z.preprocess(emptyToUndefined, z.coerce.number().int().positive().max(200).optional()),
  priceMax: z.preprocess(emptyToUndefined, z.coerce.number().int().positive().optional()),
  cursor: z.string().optional(),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;
/** Raw form/URL shape before the guests/priceMax preprocess coerces them to numbers. */
export type SearchParamsInput = z.input<typeof searchParamsSchema>;

/** Next.js page `searchParams` is `Record<string, string | string[] | undefined>`; flatten before validating. */
export function parseSearchParams(
  raw: Record<string, string | string[] | undefined>,
): SearchParams {
  const flat = Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [
      key,
      Array.isArray(value) ? value[0] : value,
    ]),
  );
  const result = searchParamsSchema.safeParse(flat);
  return result.success ? result.data : {};
}
