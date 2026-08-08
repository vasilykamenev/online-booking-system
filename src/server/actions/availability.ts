"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { Locale } from "@/i18n/routing";
import { availabilityBlockSchema } from "@/lib/validation/availability";
import { toDateRangeLiteral } from "@/lib/supabase/date-range";

export interface AvailabilityActionState {
  error?: string;
}

export async function addAvailabilityBlock(
  locale: Locale,
  vesselId: string,
  _prevState: AvailabilityActionState,
  formData: FormData,
): Promise<AvailabilityActionState> {
  const parsed = availabilityBlockSchema.safeParse({
    vesselId,
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) return { error: "invalid" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "unauthenticated" };

  const { error } = await supabase.from("availability").insert({
    vessel_id: parsed.data.vesselId,
    date_range: toDateRangeLiteral(parsed.data.startDate, parsed.data.endDate),
    reason: parsed.data.reason || null,
  });
  // exclusion_violation: overlaps an existing block (or a booked range indirectly via later insert checks).
  if (error) return { error: error.code === "23P01" ? "overlap" : "generic" };

  revalidatePath(`/${locale}/owner/vessels/${vesselId}/calendar`);
  return {};
}

export interface RemoveAvailabilityBlockResult {
  error?: "generic";
}

export async function removeAvailabilityBlock(
  locale: Locale,
  vesselId: string,
  blockId: string,
): Promise<RemoveAvailabilityBlockResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("availability").delete().eq("id", blockId);
  if (error) return { error: "generic" };

  revalidatePath(`/${locale}/owner/vessels/${vesselId}/calendar`);
  return {};
}
