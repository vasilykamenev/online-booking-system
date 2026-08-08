import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { routing } from "@/i18n/routing";

/**
 * PKCE code exchange for email confirmation and password-recovery links.
 * Lives outside `[locale]` — proxy.ts excludes this path from i18n routing.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? `/${routing.defaultLocale}/account`;

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/${routing.defaultLocale}/auth/login?error=link`);
}
