"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

export default function BookingError({
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
    <div className="container-page flex min-h-[60vh] flex-col items-center justify-center text-center">
      <h2 className="text-2xl font-light tracking-tight md:text-3xl">{t("title")}</h2>
      <p className="mt-3 max-w-md text-sm font-light text-muted-foreground">
        {t("description")}
      </p>
      <Button className="mt-8 rounded-full" onClick={() => retry()}>
        {t("retry")}
      </Button>
    </div>
  );
}
