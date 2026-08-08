import type { Locale } from "@/i18n/routing";
import { redirect } from "@/i18n/navigation";

export default async function OwnerHomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = (await params) as { locale: Locale };
  redirect({ href: "/owner/vessels", locale });
}
