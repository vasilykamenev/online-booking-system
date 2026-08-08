"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Menu } from "lucide-react";
import { useTranslations } from "next-intl";
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
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { LocaleSwitcher } from "@/components/layout/locale-switcher";
import { Logo } from "@/components/layout/logo";

const TRANSPARENT_HERO_PATHS = new Set(["/", "/about"]);

export function Header() {
  const [isScrolled, setIsScrolled] = useState(false);
  const t = useTranslations("nav");
  const pathname = usePathname();
  const hasDarkHero = TRANSPARENT_HERO_PATHS.has(pathname);

  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const navItems = [
    { label: t("vessels"), href: "/#vessels" },
    { label: t("destinations"), href: "/#vessels" },
    { label: t("initiatives"), href: "/#initiatives" },
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
            Meridian
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
          <Button
            variant="ghost"
            size="sm"
            className="ml-1 text-[11px] uppercase tracking-wider hover:bg-white/10"
          >
            {t("signIn")}
          </Button>
          <Button
            size="sm"
            className={`rounded-full text-[11px] uppercase tracking-wider ${
              solid
                ? ""
                : "bg-white/15 text-white border border-white/30 backdrop-blur-md hover:bg-white/25"
            }`}
          >
            {t("listVessel")}
          </Button>
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
                <Button variant="outline">{t("signIn")}</Button>
                <Button>{t("listVessel")}</Button>
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
