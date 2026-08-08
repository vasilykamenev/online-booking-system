"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { profileSchema } from "@/lib/validation/profile";
import type { Locale } from "@/i18n/routing";

export interface ProfileActionState {
  error?: string;
  success?: boolean;
}

export async function updateProfile(
  locale: Locale,
  _prevState: ProfileActionState,
  formData: FormData,
): Promise<ProfileActionState> {
  const parsed = profileSchema.safeParse({
    fullName: formData.get("fullName"),
    locale: formData.get("locale"),
    currency: formData.get("currency"),
  });
  if (!parsed.success) return { error: "invalid" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "unauthenticated" };

  const { error } = await supabase
    .from("profiles")
    .update({
      full_name: parsed.data.fullName,
      locale: parsed.data.locale,
      currency: parsed.data.currency,
    })
    .eq("id", user.id);

  if (error) return { error: "generic" };

  revalidatePath(`/${locale}/account`);
  return { success: true };
}
