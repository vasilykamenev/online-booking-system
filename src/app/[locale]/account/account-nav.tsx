"use client";

import { Compass, Heart, LogOut, MessageSquare, Ship, User } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/routing";
import { Link, usePathname } from "@/i18n/navigation";
import { signOut } from "@/server/actions/auth";

const items = [
  { href: "/account", key: "profile", icon: User },
  { href: "/account/favorites", key: "favorites", icon: Heart },
  { href: "/account/bookings", key: "bookings", icon: Ship },
  { href: "/account/initiatives", key: "initiatives", icon: Compass },
  { href: "/account/messages", key: "messages", icon: MessageSquare },
] as const;

export function AccountNav({
  fullName,
  email,
}: {
  fullName: string | null;
  email: string;
}) {
  const t = useTranslations("account.nav");
  const tNav = useTranslations("nav");
  const pathname = usePathname();
  const locale = useLocale() as Locale;

  return (
    <aside className="h-fit rounded-2xl border border-border bg-card p-5 shadow-soft lg:sticky lg:top-28">
      <div className="border-b border-border pb-4">
        <p className="truncate text-sm font-medium tracking-tight">{fullName || email}</p>
        <p className="mt-0.5 truncate text-xs font-light text-muted-foreground">{email}</p>
      </div>

      <nav className="mt-4 flex flex-col gap-1">
        {items.map(({ href, key, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                active
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <Icon className="size-4" strokeWidth={1.5} />
              {t(key)}
            </Link>
          );
        })}
      </nav>

      <form action={signOut.bind(null, locale)} className="mt-4 border-t border-border pt-4">
        <button
          type="submit"
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <LogOut className="size-4" strokeWidth={1.5} />
          {tNav("signOut")}
        </button>
      </form>
    </aside>
  );
}
