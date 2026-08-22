"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Heart, LogOut, Menu, MessageSquare, Ship, ShieldCheck, User, LayoutGrid } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/routing";
import { Link, usePathname } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SheetClose,
} from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { LocaleSwitcher } from "@/components/layout/locale-switcher";
import { Logo } from "@/components/layout/logo";
import { SITE_NAME } from "@/lib/site";
import { signOut } from "@/server/actions/auth";
import type { Profile } from "@/server/queries/profile";

const TRANSPARENT_HERO_PATHS = new Set(["/", "/about"]);

export function Header({ profile }: { profile: Profile | null }) {
  const [isScrolled, setIsScrolled] = useState(false);
  const t = useTranslations("nav");
  const pathname = usePathname();
  const locale = useLocale() as Locale;
  const hasDarkHero = TRANSPARENT_HERO_PATHS.has(pathname);
  const canManageVessels = profile?.role === "owner" || profile?.role === "admin";

  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const navItems = [
    { label: t("vessels"), href: "/#vessels" },
    { label: t("discover"), href: "/discover" },
    { label: t("destinations"), href: "/#vessels" },
    { label: t("initiatives"), href: "/initiatives" },
    { label: t("about"), href: "/about" },
  ];

  const solid = isScrolled || !hasDarkHero;

  return (
    <motion.header
      initial={{ y: -80, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-400 ${
        solid
          ? "bg-background/95 backdrop-blur-lg shadow-soft text-foreground"
          : "bg-transparent text-white"
      }`}
    >
      <div className="container-page flex h-18 items-center justify-between py-4">
        <Link href="/" className="flex items-center shrink-0">
          <Logo variant="mark" forceMono={!solid} className="h-8 w-auto" priority />
          <span className="text-base font-medium tracking-tight">
            {SITE_NAME}
          </span>
        </Link>

        <nav className="hidden items-center gap-9 md:flex">
          {navItems.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className="text-[11px] uppercase tracking-wider hover:opacity-70 transition-opacity"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-1 md:flex">
          <ThemeToggle />
          <LocaleSwitcher />
          {profile ? (
            <UserMenu profile={profile} locale={locale} className="ml-1" />
          ) : (
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="ml-1 text-[11px] uppercase tracking-wider hover:bg-white/10"
            >
              <Link href="/auth/login">{t("signIn")}</Link>
            </Button>
          )}
          {canManageVessels && (
            <Button
              asChild
              size="sm"
              className={`rounded-full text-[11px] uppercase tracking-wider ${
                solid
                  ? ""
                  : "bg-white/15 text-white border border-white/30 backdrop-blur-md hover:bg-white/25"
              }`}
            >
              <Link href="/owner/vessels/new">{t("listVessel")}</Link>
            </Button>
          )}
        </div>

        <div className="flex items-center gap-1 md:hidden">
          <ThemeToggle />
          <Sheet>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("openMenu")}
                className="hover:bg-white/10"
              >
                <Menu className="size-5" strokeWidth={1.5} />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-72">
              <SheetHeader>
                <SheetTitle className="flex items-center">
                  <Logo variant="mark" className="h-7 w-auto" />
                </SheetTitle>
              </SheetHeader>
              <nav className="flex flex-col gap-1 px-4">
                {navItems.map((item) => (
                  <SheetClose asChild key={item.label}>
                    <Link
                      href={item.href}
                      className="py-3 text-sm uppercase tracking-wider text-foreground/90 hover:text-foreground border-b border-border last:border-0"
                    >
                      {item.label}
                    </Link>
                  </SheetClose>
                ))}
              </nav>
              <div className="mt-4 flex flex-col gap-2 px-4">
                {profile ? (
                  <>
                    <SheetClose asChild>
                      <Button asChild variant="outline">
                        <Link href="/account">{t("account")}</Link>
                      </Button>
                    </SheetClose>
                    <form action={signOut.bind(null, locale)}>
                      <Button type="submit" variant="ghost" className="w-full">
                        {t("signOut")}
                      </Button>
                    </form>
                  </>
                ) : (
                  <SheetClose asChild>
                    <Button asChild variant="outline">
                      <Link href="/auth/login">{t("signIn")}</Link>
                    </Button>
                  </SheetClose>
                )}
                {canManageVessels && (
                  <SheetClose asChild>
                    <Button asChild>
                      <Link href="/owner/vessels/new">{t("listVessel")}</Link>
                    </Button>
                  </SheetClose>
                )}
                <div className="pt-2">
                  <LocaleSwitcher />
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </motion.header>
  );
}

function UserMenu({
  profile,
  locale,
  className,
}: {
  profile: Profile;
  locale: Locale;
  className?: string;
}) {
  const t = useTranslations("nav");
  const initials = (profile.fullName || profile.email).slice(0, 1).toUpperCase();
  const canManageVessels = profile.role === "owner" || profile.role === "admin";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={t("account")}
          className={`flex size-8 items-center justify-center rounded-full bg-primary/15 text-xs font-medium text-primary transition-opacity hover:opacity-80 ${className ?? ""}`}
        >
          {initials}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem asChild>
          <Link href="/account">
            <User className="size-4" strokeWidth={1.5} />
            {t("account")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/account/favorites">
            <Heart className="size-4" strokeWidth={1.5} />
            {t("myFavorites")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/account/bookings">
            <Ship className="size-4" strokeWidth={1.5} />
            {t("myBookings")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/account/messages">
            <MessageSquare className="size-4" strokeWidth={1.5} />
            {t("myMessages")}
          </Link>
        </DropdownMenuItem>
        {canManageVessels && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/owner/vessels">
                <LayoutGrid className="size-4" strokeWidth={1.5} />
                {t("ownerPanel")}
              </Link>
            </DropdownMenuItem>
          </>
        )}
        {profile.role === "admin" && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/admin">
                <ShieldCheck className="size-4" strokeWidth={1.5} />
                {t("adminPanel")}
              </Link>
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => signOut(locale)}>
          <LogOut className="size-4" strokeWidth={1.5} />
          {t("signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
