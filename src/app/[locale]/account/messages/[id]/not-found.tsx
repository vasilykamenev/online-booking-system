import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";

export default async function ConversationNotFound() {
  const t = await getTranslations("account.messages.notFound");

  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center text-center">
      <h2 className="text-xl font-light tracking-tight">{t("title")}</h2>
      <p className="mt-3 max-w-md text-sm font-light text-muted-foreground">
        {t("description")}
      </p>
      <Link href="/account/messages">
        <Button className="mt-8 rounded-full">{t("cta")}</Button>
      </Link>
    </div>
  );
}
