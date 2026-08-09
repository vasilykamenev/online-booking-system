"use client";

import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/routing";
import { Link, useRouter } from "@/i18n/navigation";
import { respondToInitiative, type RespondActionState } from "@/server/actions/initiatives";
import { initiativeResponseTypeValues } from "@/lib/validation/initiative";
import type { InitiativeResponse } from "@/server/queries/initiatives";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const initialState: RespondActionState = {};

export function RespondForm({
  initiativeId,
  isAuthenticated,
  initiativeOpen,
  myResponse,
  conversationId,
}: {
  initiativeId: string;
  isAuthenticated: boolean;
  initiativeOpen: boolean;
  myResponse: InitiativeResponse | null;
  conversationId: string | null;
}) {
  const t = useTranslations("initiativesPage.respond");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(
    respondToInitiative.bind(null, locale, initiativeId),
    initialState,
  );
  const prevStateRef = useRef(state);

  useEffect(() => {
    if (state !== prevStateRef.current) {
      prevStateRef.current = state;
      if (state.success) {
        toast.success(t("sent"));
        router.refresh();
      }
    }
  }, [state, router, t]);

  if (!isAuthenticated) {
    return (
      <div className="text-center">
        <p className="text-sm font-light text-muted-foreground">{t("signInRequired")}</p>
        <Button asChild className="mt-4 w-full rounded-full">
          <Link href="/auth/login">{t("signIn")}</Link>
        </Button>
      </div>
    );
  }

  if (myResponse) {
    return (
      <div>
        <span className="uppercase-label mb-2 block">{t("alreadyResponded")}</span>
        <p className="text-sm font-light text-muted-foreground">
          {t(`types.${myResponse.type}`)}
        </p>
        {conversationId && (
          <Button asChild className="mt-4 w-full rounded-full">
            <Link href={`/account/messages/${conversationId}`}>{t("openConversation")}</Link>
          </Button>
        )}
      </div>
    );
  }

  if (!initiativeOpen) {
    return <p className="text-sm font-light text-muted-foreground">{t("closed")}</p>;
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <span className="uppercase-label block">{t("eyebrow")}</span>

      <div className="flex flex-col gap-2">
        <Label>{t("type")}</Label>
        <Select name="type" defaultValue={initiativeResponseTypeValues[0]}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {initiativeResponseTypeValues.map((value) => (
              <SelectItem key={value} value={value}>
                {t(`types.${value}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="message">{t("message")}</Label>
        <Textarea id="message" name="message" rows={4} placeholder={t("messagePlaceholder")} />
      </div>

      {state.error && <p className="text-sm text-destructive">{t(`errors.${state.error}`)}</p>}

      <Button type="submit" size="lg" disabled={isPending} className="rounded-full">
        {t("submit")}
      </Button>
    </form>
  );
}
