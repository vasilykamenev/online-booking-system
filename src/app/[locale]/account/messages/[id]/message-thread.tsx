"use client";

import { useActionState, useEffect, useRef } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/routing";
import { useRouter } from "@/i18n/navigation";
import { sendMessage, type SendMessageResult } from "@/server/actions/messages";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface ThreadMessage {
  id: string;
  body: string;
  senderId: string;
  createdAt: string;
}

const initialState: SendMessageResult = {};

export function MessageThread({
  conversationId,
  messages,
  viewerId,
}: {
  conversationId: string;
  messages: ThreadMessage[];
  viewerId: string;
}) {
  const t = useTranslations("account.messages");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const prevStateRef = useRef<SendMessageResult>(initialState);
  const [state, formAction, isPending] = useActionState(
    sendMessage.bind(null, locale, conversationId),
    initialState,
  );
  const timeFormatter = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });

  useEffect(() => {
    if (state !== prevStateRef.current) {
      prevStateRef.current = state;
      if (!state.error) {
        formRef.current?.reset();
        router.refresh();
      }
    }
  }, [state, router]);

  return (
    <div>
      {messages.length === 0 ? (
        <p className="py-10 text-center text-sm font-light text-muted-foreground">
          {t("emptyThread")}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {messages.map((message) => {
            const isOwn = message.senderId === viewerId;
            return (
              <li key={message.id} className={cn("flex", isOwn ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[75%] rounded-2xl px-4 py-2.5 text-sm font-light leading-relaxed",
                    isOwn
                      ? "bg-primary text-primary-foreground"
                      : "border border-border bg-card text-card-foreground",
                  )}
                >
                  <p className="whitespace-pre-line">{message.body}</p>
                  <p
                    className={cn(
                      "mt-1 text-[10px] uppercase tracking-wider",
                      isOwn ? "text-primary-foreground/70" : "text-muted-foreground",
                    )}
                  >
                    {timeFormatter.format(new Date(message.createdAt))}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <form ref={formRef} action={formAction} className="mt-6 flex flex-col gap-3">
        <Textarea
          name="body"
          rows={3}
          placeholder={t("replyPlaceholder")}
          required
          className="resize-none"
        />
        {state.error && <p className="text-sm text-destructive">{t(`errors.${state.error}`)}</p>}
        <Button type="submit" disabled={isPending} className="w-fit rounded-full">
          {t("send")}
        </Button>
      </form>
    </div>
  );
}
