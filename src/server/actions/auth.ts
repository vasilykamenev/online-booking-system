"use server";

import { headers } from "next/headers";
import type { AuthError } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import {
  loginSchema,
  registerSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from "@/lib/validation/auth";

export interface AuthActionState {
  error?: string;
  success?: boolean;
}

/** Maps Supabase Auth error codes to next-intl keys under the "auth.errors" namespace. */
function mapAuthError(error: AuthError): string {
  switch (error.code) {
    case "invalid_credentials":
      return "invalidCredentials";
    case "user_already_exists":
    case "email_exists":
      return "emailTaken";
    case "weak_password":
      return "weakPassword";
    case "over_email_send_rate_limit":
      return "rateLimited";
    default:
      return "generic";
  }
}

async function getOrigin(): Promise<string> {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  const headersList = await headers();
  const host = headersList.get("host") ?? "localhost:3000";
  const protocol = host.startsWith("localhost") ? "http" : "https";
  return `${protocol}://${host}`;
}

export async function signIn(
  locale: Locale,
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: "invalidCredentials" };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: mapAuthError(error) };

  return redirect({ href: "/account", locale });
}

export async function signUp(
  locale: Locale,
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = registerSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: "generic" };

  const origin = await getOrigin();
  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.fullName, locale, currency: "USD" },
      emailRedirectTo: `${origin}/auth/callback?next=/${locale}/account`,
    },
  });
  if (error) return { error: mapAuthError(error) };

  return { success: true };
}

export async function signOut(locale: Locale): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect({ href: "/", locale });
}

export async function requestPasswordReset(
  locale: Locale,
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = forgotPasswordSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) return { error: "generic" };

  const origin = await getOrigin();
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${origin}/auth/callback?next=/${locale}/auth/reset-password`,
  });
  if (error) return { error: mapAuthError(error) };

  return { success: true };
}

export async function updatePassword(
  locale: Locale,
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = resetPasswordSchema.safeParse({ password: formData.get("password") });
  if (!parsed.success) return { error: "weakPassword" };

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { error: mapAuthError(error) };

  return redirect({ href: "/account", locale });
}
