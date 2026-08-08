import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import type { Database } from "@/lib/supabase/database.types";

export interface Profile {
  id: string;
  email: string;
  role: Database["public"]["Enums"]["user_role"];
  fullName: string | null;
  avatarUrl: string | null;
  locale: string;
  currency: string;
}

/** Memoized per request: safe to call from multiple Server Components without duplicate round-trips. */
export const getCurrentProfile = cache(async (): Promise<Profile | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, role, full_name, avatar_url, locale, currency")
    .eq("id", user.id)
    .single();

  if (error || !profile) return null;

  return {
    id: profile.id,
    email: user.email ?? "",
    role: profile.role,
    fullName: profile.full_name,
    avatarUrl: profile.avatar_url,
    locale: profile.locale,
    currency: profile.currency,
  };
});

/** Secure re-check for protected pages — proxy.ts already redirects optimistically, this is defense in depth. */
export async function requireProfile(locale: Locale): Promise<Profile> {
  const profile = await getCurrentProfile();
  if (!profile) {
    return redirect({ href: "/auth/login", locale });
  }
  return profile;
}
