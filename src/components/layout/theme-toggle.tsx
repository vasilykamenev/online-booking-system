"use client";

import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const t = useTranslations("theme");

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={t("toggle")}
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      className="text-current hover:bg-white/10"
    >
      <Sun className="hidden size-[18px] dark:block" strokeWidth={1.5} />
      <Moon className="size-[18px] dark:hidden" strokeWidth={1.5} />
    </Button>
  );
}
