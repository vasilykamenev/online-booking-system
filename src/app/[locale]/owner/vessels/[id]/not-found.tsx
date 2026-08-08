import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";

export default async function OwnerVesselNotFound() {
  const t = await getTranslations("owner.vessels.notFound");

  return (
    <div className="rounded-2xl border border-dashed border-border p-10 text-center">
      <h2 className="text-xl font-light tracking-tight">{t("title")}</h2>
      <p className="mt-2 text-sm font-light text-muted-foreground">{t("description")}</p>
      <Link href="/owner/vessels">
        <Button className="mt-6 rounded-full">{t("cta")}</Button>
      </Link>
    </div>
  );
}
