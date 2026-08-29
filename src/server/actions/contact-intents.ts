"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Locale } from "@/i18n/routing";
import type { Database } from "@/lib/supabase/database.types";
import { createContactIntentSchema, confirmContactIntentSchema } from "@/lib/validation/contact-intent";
import { draftContactMessage } from "@/server/ai/message-generator";

/**
 * Э9 (docs/AI_Federated_Search_Migration_Plan_v1.md §6, Арх §20): "Запросить у поставщика" for an
 * external offer. Internal vessels never call this — they already have a real booking flow and
 * `conversations`/`messages` (see `contact_intents`' own migration comment).
 *
 * Honest scope boundary: no currently registered source has a real email address, contact-form URL,
 * or API credential configured anywhere in the schema — `search_sources`/`search_source_policies`
 * carry a *capability* (`contact_capability`), never a *destination*. So only `REDIRECT_ONLY`/
 * `EXTERNAL_BOOKING_URL` (a link the user opens themselves) can genuinely be fulfilled today.
 * `EMAIL`/`CONTACT_FORM`/`PROVIDER_API`/`PLATFORM_MESSAGE` (the last one structurally shouldn't occur
 * here at all — it's internal-vessel-only) still get a real AI-drafted message the user can copy and
 * send themselves, but `confirmContactIntent` marks the record `FAILED` rather than `SENT` for them —
 * not a bug, the honest and literal reading of "we have nowhere to actually deliver this yet". Wiring
 * a real destination per source is Э10's job (Source Onboarding v2), not this stage's.
 */

type ContactCapability = Database["public"]["Enums"]["search_contact_capability"];

const REDIRECT_CAPABILITIES: ContactCapability[] = ["REDIRECT_ONLY", "EXTERNAL_BOOKING_URL"];

export interface CreateContactIntentState {
  error?: "unauthenticated" | "invalid" | "generic";
  intentId?: string;
  /** Set only for REDIRECT_ONLY/EXTERNAL_BOOKING_URL — already `CONFIRMED`, nothing left to review. */
  redirectUrl?: string;
  /** Set only for a message-based capability — still `DRAFT`, shown for review/editing. */
  draft?: string;
}

export async function createContactIntentDraft(
  locale: Locale,
  _prevState: CreateContactIntentState,
  formData: FormData,
): Promise<CreateContactIntentState> {
  const parsed = createContactIntentSchema.safeParse({
    sourceId: formData.get("sourceId"),
    externalId: formData.get("externalId"),
    listingUrl: formData.get("listingUrl"),
    vesselName: formData.get("vesselName") || null,
    dateFrom: formData.get("dateFrom") || null,
    dateTo: formData.get("dateTo") || null,
    guests: formData.get("guests") || null,
    userNote: formData.get("userNote") || null,
  });
  if (!parsed.success) return { error: "invalid" };
  const input = parsed.data;
  // No `type` field in the form — a dated request is self-evidently a booking request, a bare
  // question is self-evidently just a contact request. `INFO_REQUEST` stays in the enum for a
  // future entry point (e.g. an admin-initiated intent) that isn't this one.
  const type: Database["public"]["Enums"]["intent_type"] = input.dateFrom && input.dateTo ? "BOOKING_REQUEST" : "CONTACT_REQUEST";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "unauthenticated" };

  const { data: source } = await supabase
    .from("search_sources")
    .select("id, name, contact_capability")
    .eq("id", input.sourceId)
    .maybeSingle();
  if (!source) return { error: "generic" };

  // Same default every adapter already applies on its own (`generic-adapter.ts`/`brilions-adapter.ts`'s
  // `getContactCapability()`) — resolved here from the source of truth, never trusted from client input.
  const capability: ContactCapability = source.contact_capability ?? "REDIRECT_ONLY";

  // Best-effort: a delisted or not-yet-indexed row still lets the intent through — `listingUrl`
  // (from the client's own `VesselSearchResult.source.url`) already carries what the user is
  // actually looking at, independent of whether the index still has a matching row.
  const { data: indexRow } = await createAdminClient()
    .from("external_vessel_index")
    .select("id")
    .eq("source_id", input.sourceId)
    .eq("external_id", input.externalId)
    .maybeSingle();

  if (REDIRECT_CAPABILITIES.includes(capability)) {
    // Nothing to draft or review for a plain link — module doc comment's Арх §20 note: opening a
    // page is not something *we* sent, so this goes straight to CONFIRMED, never SENT, recording
    // the fact of the redirect rather than pretending more happened.
    const { data: inserted, error } = await supabase
      .from("contact_intents")
      .insert({
        user_id: user.id,
        source_id: input.sourceId,
        external_vessel_id: input.externalId,
        index_id: indexRow?.id ?? null,
        type,
        status: "CONFIRMED",
        date_from: input.dateFrom,
        date_to: input.dateTo,
        guests: input.guests,
        contact_capability: capability,
        delivery_channel: "REDIRECT",
        delivery_reference: input.listingUrl,
        confirmed_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error || !inserted) return { error: "generic" };
    return { intentId: inserted.id, redirectUrl: input.listingUrl };
  }

  const draft = await draftContactMessage({
    type,
    locale,
    vesselName: input.vesselName,
    sourceName: source.name,
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
    guests: input.guests,
    userNote: input.userNote,
  });

  const { data: inserted, error } = await supabase
    .from("contact_intents")
    .insert({
      user_id: user.id,
      source_id: input.sourceId,
      external_vessel_id: input.externalId,
      index_id: indexRow?.id ?? null,
      type,
      status: "DRAFT",
      date_from: input.dateFrom,
      date_to: input.dateTo,
      guests: input.guests,
      contact_capability: capability,
      message_draft: draft.body,
    })
    .select("id")
    .single();
  if (error || !inserted) return { error: "generic" };

  return { intentId: inserted.id, draft: draft.body };
}

export interface ConfirmContactIntentState {
  error?: "unauthenticated" | "invalid" | "generic";
  success?: boolean;
}

/** The user's explicit go-ahead (Арх §20's one unconditional rule) on a message-based intent's
 *  final text — see this file's own module doc comment for why the outcome is honestly `FAILED`,
 *  not `SENT`, until a source has a real destination configured (Э10). */
export async function confirmContactIntent(
  _prevState: ConfirmContactIntentState,
  formData: FormData,
): Promise<ConfirmContactIntentState> {
  const parsed = confirmContactIntentSchema.safeParse({
    intentId: formData.get("intentId"),
    messageSent: formData.get("messageSent") || null,
  });
  if (!parsed.success) return { error: "invalid" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "unauthenticated" };

  const { data: intent } = await supabase
    .from("contact_intents")
    .select("id, status")
    .eq("id", parsed.data.intentId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!intent) return { error: "generic" };
  if (intent.status !== "DRAFT") return { error: "generic" }; // already confirmed — no double-confirm

  const { error } = await supabase
    .from("contact_intents")
    .update({
      message_sent: parsed.data.messageSent,
      status: "FAILED",
      confirmed_at: new Date().toISOString(),
    })
    .eq("id", intent.id);
  if (error) return { error: "generic" };

  return { success: true };
}
