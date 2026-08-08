"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { Locale } from "@/i18n/routing";
import { pricingRuleSchema } from "@/lib/validation/pricing";
import { toDateRangeLiteral } from "@/lib/supabase/date-range";

export interface PricingActionState {
  error?: string;
}

export async function createPricingRule(
  locale: Locale,
  vesselId: string,
  _prevState: PricingActionState,
  formData: FormData,
): Promise<PricingActionState> {
  const parsed = pricingRuleSchema.safeParse({
    vesselId,
    label: formData.get("label"),
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
    price: formData.get("price"),
    priority: formData.get("priority"),
  });
  if (!parsed.success) return { error: "invalid" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "unauthenticated" };

  const { error } = await supabase.from("pricing_rules").insert({
    vessel_id: parsed.data.vesselId,
    label: parsed.data.label,
    date_range: toDateRangeLiteral(parsed.data.startDate, parsed.data.endDate),
    price_minor: Math.round(parsed.data.price * 100),
    priority: parsed.data.priority,
  });
  if (error) return { error: "generic" };

  revalidatePath(`/${locale}/owner/vessels/${vesselId}/pricing`);
  return {};
}

export interface DeletePricingRuleResult {
  error?: "generic";
}

export async function deletePricingRule(
  locale: Locale,
  vesselId: string,
  ruleId: string,
): Promise<DeletePricingRuleResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("pricing_rules").delete().eq("id", ruleId);
  if (error) return { error: "generic" };

  revalidatePath(`/${locale}/owner/vessels/${vesselId}/pricing`);
  return {};
}
