import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { requireProfile } from "@/server/queries/profile";
import { getConversationById } from "@/server/queries/messages";
import { MessageThread } from "./message-thread";
import { buildTitle } from "@/lib/site";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "account.messages" });
  return { title: buildTitle(t("title")) };
}

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = (await params) as { locale: Locale; id: string };
  setRequestLocale(locale);
  const profile = await requireProfile(locale);

  const conversation = await getConversationById(id, profile.id);
  if (!conversation) notFound();

  const t = await getTranslations("account.messages");

  return (
    <div>
      <h1 className="text-xl font-medium tracking-tight">
        {conversation.otherParticipantNames.join(", ") || t("unknownParticipant")}
      </h1>

      <div className="mt-6">
        <MessageThread
          conversationId={conversation.id}
          messages={conversation.messages}
          viewerId={profile.id}
        />
      </div>
    </div>
  );
}
