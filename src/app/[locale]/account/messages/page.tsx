import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { Link } from "@/i18n/navigation";
import { requireProfile } from "@/server/queries/profile";
import { getConversations } from "@/server/queries/messages";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "account.messages" });
  return { title: `${t("title")} — Meridian` };
}

export default async function AccountMessagesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  const t = await getTranslations("account.messages");

  const profile = await requireProfile(locale);
  const conversations = await getConversations(profile.id);
  const dateFormatter = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });

  return (
    <div>
      <h1 className="text-xl font-medium tracking-tight">{t("title")}</h1>
      <p className="mt-1 text-sm font-light text-muted-foreground">{t("subtitle")}</p>

      {conversations.length === 0 ? (
        <p className="mt-10 rounded-2xl border border-dashed border-border p-10 text-center text-sm font-light text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <ul className="mt-6 space-y-3">
          {conversations.map((conversation) => (
            <li key={conversation.id}>
              <Link
                href={`/account/messages/${conversation.id}`}
                className="block rounded-2xl border border-border bg-card p-4 shadow-soft transition-colors hover:border-primary/25"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate text-sm font-medium">
                    {conversation.otherParticipantNames.join(", ") || t("unknownParticipant")}
                  </span>
                  {conversation.lastMessage && (
                    <span className="shrink-0 text-xs font-light text-muted-foreground">
                      {dateFormatter.format(new Date(conversation.lastMessage.createdAt))}
                    </span>
                  )}
                </div>
                {conversation.lastMessage && (
                  <p className="mt-1 truncate text-sm font-light text-muted-foreground">
                    {conversation.lastMessage.body}
                  </p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
