import { z } from "zod";
import type { Database } from "@/lib/supabase/database.types";

export const initiativeStatusValues = [
  "open",
  "closed",
] as const satisfies readonly Database["public"]["Enums"]["initiative_status"][];

export const initiativeResponseTypeValues = [
  "participation",
  "collaboration",
  "info_request",
] as const satisfies readonly Database["public"]["Enums"]["initiative_response_type"][];

export const initiativeSchema = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().min(10).max(4000),
  // Free-text, not an enum: new topics/regions/activity types must be addable as
  // data, not code (CLAUDE.md §9) — the feed filters read distinct values from the table.
  topic: z.string().trim().min(2).max(100),
  region: z.string().trim().min(2).max(100),
  activityType: z.string().trim().min(2).max(100),
});
export type InitiativeInput = z.infer<typeof initiativeSchema>;

export const initiativeResponseSchema = z.object({
  initiativeId: z.guid(),
  type: z.enum(initiativeResponseTypeValues),
  message: z.string().trim().max(2000).default(""),
});
export type InitiativeResponseInput = z.infer<typeof initiativeResponseSchema>;

export const initiativeFiltersSchema = z.object({
  topic: z.string().trim().max(100).optional(),
  region: z.string().trim().max(100).optional(),
  activityType: z.string().trim().max(100).optional(),
  status: z.enum(initiativeStatusValues).optional(),
  cursor: z.string().optional(),
});
export type InitiativeFilters = z.infer<typeof initiativeFiltersSchema>;

/** Next.js page `searchParams` is `Record<string, string | string[] | undefined>`; flatten before validating. */
export function parseInitiativeFilters(
  raw: Record<string, string | string[] | undefined>,
): InitiativeFilters {
  const flat = Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
  );
  const result = initiativeFiltersSchema.safeParse(flat);
  return result.success ? result.data : {};
}
