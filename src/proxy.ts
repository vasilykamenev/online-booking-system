import { NextResponse, type NextRequest } from "next/server";
import createMiddleware from "next-intl/middleware";
import { createServerClient } from "@supabase/ssr";
import { routing, type Locale } from "@/i18n/routing";
import type { Database } from "@/lib/supabase/database.types";

const handleI18nRouting = createMiddleware(routing);

const PROTECTED_SEGMENTS = ["account", "owner", "admin"];
// "auth/reset-password" is reached with an active (recovery) session, so it's excluded
// from the guest-only redirect below — everything else under /auth requires being signed out.
const GUEST_ONLY_EXCEPTIONS = ["/auth/reset-password"];

/** Splits a pathname like "/ru/account/favorites" into its locale and the rest ("/account/favorites"). */
function splitLocale(pathname: string): { locale: Locale; rest: string } {
  const [, maybeLocale, ...restParts] = pathname.split("/");
  if ((routing.locales as readonly string[]).includes(maybeLocale)) {
    return { locale: maybeLocale as Locale, rest: `/${restParts.join("/")}` };
  }
  return { locale: routing.defaultLocale, rest: pathname };
}

export default async function proxy(request: NextRequest) {
  const response = handleI18nRouting(request);

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // getUser() revalidates the token against Supabase Auth (unlike getSession(),
  // which only decodes the cookie) — required for a trustworthy optimistic check here.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { locale, rest } = splitLocale(request.nextUrl.pathname);
  const firstSegment = rest.split("/")[1] ?? "";

  if (PROTECTED_SEGMENTS.includes(firstSegment) && !user) {
    return NextResponse.redirect(new URL(`/${locale}/auth/login`, request.url));
  }

  const isGuestOnlyAuthPage =
    firstSegment === "auth" && !GUEST_ONLY_EXCEPTIONS.includes(rest);
  if (isGuestOnlyAuthPage && user) {
    return NextResponse.redirect(new URL(`/${locale}/account`, request.url));
  }

  return response;
}

export const config = {
  matcher: ["/((?!api|auth/callback|_next|_vercel|.*\\..*).*)"],
};
