import "server-only";
import { AI_CALL_TIMEOUT_MS, AI_MODELS, getAnthropicClient } from "@/server/ai/client";
import type { Locale } from "@/i18n/routing";
import type { Database } from "@/lib/supabase/database.types";

/**
 * `intents/message-generator.ts` (docs/AI_Federated_Search_Migration_Plan_v1.md §6, Э9, Арх §18
 * п.7) — drafts the message a user sends a provider through `actions/contact-intents.ts`. Mirrors
 * `query-interpreter.ts`'s own discipline: never fails the flow when the model is unavailable, and
 * whatever comes back is a *draft* the user still reviews and can edit before anything is confirmed
 * (Арх §20's own rule, enforced by the caller, not this module).
 *
 * Body only, no separate subject: `contact_intents.message_draft`/`message_sent` (Э9's own
 * migration) are single text columns, matching the plan's own schema — a source's own contact form
 * or inbox rarely has a distinct subject field either, so nothing downstream needs one.
 */

export type IntentType = Database["public"]["Enums"]["intent_type"];

export interface MessageDraftInput {
  type: IntentType;
  locale: Locale;
  vesselName: string | null;
  sourceName: string;
  dateFrom: string | null;
  dateTo: string | null;
  guests: number | null;
  /** Free text the user typed before generating a draft ("нужен шкипер", "интересует скидка на
   *  месяц") — folded into the prompt when present, never invented when absent. */
  userNote: string | null;
}

export interface MessageDraft {
  body: string;
  mode: "AI" | "TEMPLATE";
}

const DRAFT_TOOL = {
  name: "record_message_draft",
  description: "Record the drafted body of a message to a vessel-rental provider.",
  input_schema: {
    type: "object" as const,
    properties: {
      body: {
        type: "string",
        description: "A polite, concise message body in the requested language. No greeting placeholders like [Name] — write it ready to send as-is, signed only as \"the platform's visitor\" (translated appropriately), never inventing a name.",
      },
    },
    required: ["body"],
  },
};

const INTENT_LABEL: Record<IntentType, Record<Locale, string>> = {
  CONTACT_REQUEST: { ru: "вопрос о судне", en: "a question about the vessel" },
  BOOKING_REQUEST: { ru: "запрос на бронирование", en: "a booking request" },
  INFO_REQUEST: { ru: "запрос дополнительной информации", en: "a request for more information" },
};

function buildPrompt(input: MessageDraftInput): string {
  const lines = [
    `Write ${INTENT_LABEL[input.type][input.locale]} to the provider of the listing "${input.vesselName ?? "this vessel"}" on ${input.sourceName}.`,
    `Reply language: ${input.locale === "ru" ? "Russian" : "English"}.`,
  ];
  if (input.dateFrom && input.dateTo) lines.push(`Requested dates: ${input.dateFrom} to ${input.dateTo}.`);
  if (input.guests) lines.push(`Party size: ${input.guests} guests.`);
  if (input.userNote) lines.push(`The visitor also added: "${input.userNote}"`);
  return lines.join("\n");
}

/** Deterministic fallback (no API key, or the model call failed/timed out) — a plain, honestly
 *  generic template rather than nothing at all. Exported (mirrors `interpret-fallback.ts`'s
 *  `interpretQueryDeterministic`) so it's directly testable without faking "no API key" through
 *  environment state. */
export function draftContactMessageTemplate(input: MessageDraftInput): MessageDraft {
  const { locale, vesselName, dateFrom, dateTo, guests, userNote } = input;
  const name = vesselName ?? (locale === "ru" ? "это судно" : "this vessel");

  if (locale === "ru") {
    const parts = [`Здравствуйте! Интересует ${name}.`];
    if (dateFrom && dateTo) parts.push(`Даты: ${dateFrom} — ${dateTo}.`);
    if (guests) parts.push(`Количество гостей: ${guests}.`);
    if (userNote) parts.push(userNote);
    parts.push("Пожалуйста, подскажите условия и стоимость. Спасибо!");
    return { body: parts.join(" "), mode: "TEMPLATE" };
  }

  const parts = [`Hello! I'm interested in ${name}.`];
  if (dateFrom && dateTo) parts.push(`Dates: ${dateFrom} to ${dateTo}.`);
  if (guests) parts.push(`Guests: ${guests}.`);
  if (userNote) parts.push(userNote);
  parts.push("Could you share availability and pricing? Thank you!");
  return { body: parts.join(" "), mode: "TEMPLATE" };
}

export async function draftContactMessage(input: MessageDraftInput): Promise<MessageDraft> {
  const client = getAnthropicClient();
  if (!client) return draftContactMessageTemplate(input);

  try {
    const response = await client.messages.create(
      {
        model: AI_MODELS.messageDraft,
        max_tokens: 512,
        tools: [DRAFT_TOOL],
        tool_choice: { type: "tool", name: DRAFT_TOOL.name },
        messages: [{ role: "user", content: buildPrompt(input) }],
      },
      { timeout: AI_CALL_TIMEOUT_MS },
    );

    const toolUse = response.content.find((block) => block.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") return draftContactMessageTemplate(input);

    const draft = toolUse.input as { body?: unknown };
    if (typeof draft.body !== "string" || !draft.body) return draftContactMessageTemplate(input);

    return { body: draft.body, mode: "AI" };
  } catch {
    return draftContactMessageTemplate(input);
  }
}
