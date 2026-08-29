"use client";

import { useActionState, useState, useTransition } from "react";
import { MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/routing";
import type { VesselSearchResult } from "@/lib/search/offer";
import {
  createContactIntentDraft,
  confirmContactIntent,
  type CreateContactIntentState,
  type ConfirmContactIntentState,
} from "@/server/actions/contact-intents";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

/**
 * "Запросить у поставщика" (Э9, docs/AI_Federated_Search_Migration_Plan_v1.md §6, Арх §20) — the
 * only entry point into `contact_intents` this project has: internal vessels use the existing
 * booking/`conversations` flow instead (see that table's own migration comment), so this only ever
 * renders for `origin === "EXTERNAL"`.
 *
 * Three states, driven by what `createContactIntentDraft` returns — never by a client-side guess at
 * the source's `contact_capability` (the server re-resolves it from `search_sources`, the source of
 * truth):
 *   1. form — collect optional dates/guests/note, submit.
 *   2. redirect — REDIRECT_ONLY/EXTERNAL_BOOKING_URL: already `CONFIRMED`, just a link to open.
 *   3. draft — a message-based capability: review/edit the AI draft, then "Скопировать" both copies
 *      it and records the user's confirmation (`confirmContactIntent`, honestly `FAILED` — see that
 *      action's own doc comment on why no capability can be auto-delivered yet).
 */
export function ContactIntentSheet({ result }: { result: VesselSearchResult }) {
  const t = useTranslations("discover.contactIntent");
  const locale = useLocale() as Locale;
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const [createState, createAction, createPending] = useActionState(
    createContactIntentDraft.bind(null, locale),
    {} as CreateContactIntentState,
  );
  const [confirmState, confirmAction] = useActionState(confirmContactIntent, {} as ConfirmContactIntentState);
  const [editedDraft, setEditedDraft] = useState<string | null>(null);

  const reset = () => {
    setEditedDraft(null);
  };

  const copyAndConfirm = () => {
    const text = editedDraft ?? createState.draft ?? "";
    navigator.clipboard.writeText(text).catch(() => {});
    toast.success(t("copied"));
    if (createState.intentId) {
      const formData = new FormData();
      formData.set("intentId", createState.intentId);
      formData.set("messageSent", text);
      startTransition(() => confirmAction(formData));
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <SheetTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="w-full gap-2 rounded-full">
          <MessageSquare className="size-3.5" strokeWidth={1.5} />
          {t("cta")}
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{t("title", { name: result.name ?? "" })}</SheetTitle>
        </SheetHeader>

        <div className="flex flex-col gap-4 px-4">
          {createState.redirectUrl ? (
            <>
              <p className="text-sm font-light text-muted-foreground">{t("redirectRecorded")}</p>
              <Button asChild className="rounded-full">
                <a href={createState.redirectUrl} target="_blank" rel="noopener noreferrer nofollow">
                  {t("openSourceCta", { name: result.source.name })}
                </a>
              </Button>
            </>
          ) : createState.draft ? (
            <>
              <p className="text-xs font-light text-muted-foreground">{t("undeliverableNotice")}</p>
              <div className="flex flex-col gap-2">
                <Label htmlFor="draftMessage">{t("draftLabel")}</Label>
                <Textarea
                  id="draftMessage"
                  rows={8}
                  value={editedDraft ?? createState.draft}
                  onChange={(event) => setEditedDraft(event.target.value)}
                />
              </div>
              {confirmState.success ? (
                <p className="text-sm font-light text-primary">{t("confirmedNotice")}</p>
              ) : (
                <Button type="button" onClick={copyAndConfirm} disabled={pending} className="rounded-full">
                  {t("copyCta")}
                </Button>
              )}
              <a
                href={result.source.url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="text-xs font-light text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground"
              >
                {t("openSourceCta", { name: result.source.name })}
              </a>
            </>
          ) : (
            <form action={createAction} className="flex flex-col gap-4">
              <input type="hidden" name="sourceId" value={result.sourceId ?? ""} />
              <input type="hidden" name="externalId" value={result.externalId ?? ""} />
              <input type="hidden" name="listingUrl" value={result.source.url} />
              <input type="hidden" name="vesselName" value={result.name ?? ""} />

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="dateFrom">{t("dateFrom")}</Label>
                  <Input id="dateFrom" name="dateFrom" type="date" />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="dateTo">{t("dateTo")}</Label>
                  <Input id="dateTo" name="dateTo" type="date" />
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="guests">{t("guests")}</Label>
                <Input
                  id="guests"
                  name="guests"
                  type="number"
                  min={1}
                  defaultValue={result.capacity.guests ?? undefined}
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="userNote">{t("note")}</Label>
                <Textarea id="userNote" name="userNote" rows={3} placeholder={t("notePlaceholder")} />
              </div>

              {createState.error && <p className="text-sm text-destructive">{t(`errors.${createState.error}`)}</p>}

              <SheetFooter className="px-0">
                <Button type="submit" disabled={createPending} className="rounded-full">
                  {t("submit")}
                </Button>
              </SheetFooter>
            </form>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
