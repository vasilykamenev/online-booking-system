import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";

export default async function BookingNotFound() {
  const t = await getTranslations("booking.notFound");

  return (
    <div className="container-page flex min-h-[60vh] flex-col items-center justify-center text-center">
      <h2 className="text-2xl font-light tracking-tight md:text-3xl">{t("title")}</h2>
      <p className="mt-3 max-w-md text-sm font-light text-muted-foreground">
        {t("description")}
      </p>
      <Link href="/#vessels">
        <Button className="mt-8 rounded-full">{t("cta")}</Button>
      </Link>
    </div>
  );
}
