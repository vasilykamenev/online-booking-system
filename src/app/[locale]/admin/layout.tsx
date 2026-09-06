import type { ReactNode } from "react";
import { setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { redirect } from "@/i18n/navigation";
import { requireProfile } from "@/server/queries/profile";
import { AdminNav } from "./admin-nav";

export default async function AdminLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  const profile = await requireProfile(locale);

  // proxy.ts only checks that the request is authenticated — the role check is defense in depth here.
  if (profile.role !== "admin") {
    return redirect({ href: "/account", locale });
  }

  return (
    <div className="pt-24 lg:pt-28">
      <div className="container-page grid grid-cols-1 gap-8 pb-24 lg:grid-cols-[260px_1fr] lg:gap-10">
        <AdminNav fullName={profile.fullName} email={profile.email} />
        {/* min-w-0: without it, a grid item defaults to min-width:auto, so a wide table below
            (e.g. urls/page.tsx's field-conflicts table) grows the whole grid track — and the
            page itself — instead of scrolling inside its own overflow-x-auto container. */}
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
