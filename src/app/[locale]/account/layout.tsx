import type { ReactNode } from "react";
import { setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { requireProfile } from "@/server/queries/profile";
import { AccountNav } from "./account-nav";

export default async function AccountLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  const profile = await requireProfile(locale);

  return (
    <div className="pt-24 lg:pt-28">
      <div className="container-page grid grid-cols-1 gap-8 pb-24 lg:grid-cols-[260px_1fr] lg:gap-10">
        <AccountNav fullName={profile.fullName} email={profile.email} />
        <div>{children}</div>
      </div>
    </div>
  );
}
