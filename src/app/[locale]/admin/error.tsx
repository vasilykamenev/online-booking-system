"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

export default function AdminError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const t = useTranslations("error");

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="rounded-2xl border border-border bg-card p-8 text-center shadow-soft">
      <h2 className="text-xl font-light tracking-tight">{t("title")}</h2>
      <p className="mt-2 text-sm font-light text-muted-foreground">{t("description")}</p>
      <Button className="mt-6 rounded-full" onClick={() => retry()}>
        {t("retry")}
      </Button>
    </div>
  );
}
