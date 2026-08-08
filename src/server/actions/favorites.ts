"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export interface ToggleFavoriteResult {
  favorited: boolean;
  error?: "unauthenticated" | "generic";
}

export async function toggleFavorite(vesselId: string): Promise<ToggleFavoriteResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { favorited: false, error: "unauthenticated" };

  const { data: existing, error: selectError } = await supabase
    .from("favorites")
    .select("id")
    .eq("profile_id", user.id)
    .eq("vessel_id", vesselId)
    .maybeSingle();
  if (selectError) return { favorited: false, error: "generic" };

  if (existing) {
    const { error } = await supabase.from("favorites").delete().eq("id", existing.id);
    if (error) return { favorited: true, error: "generic" };
    revalidatePath("/", "layout");
    return { favorited: false };
  }

  const { error } = await supabase
    .from("favorites")
    .insert({ profile_id: user.id, vessel_id: vesselId });
  if (error) return { favorited: false, error: "generic" };

  revalidatePath("/", "layout");
  return { favorited: true };
}
