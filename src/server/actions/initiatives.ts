"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { initiativeSchema, initiativeResponseSchema, initiativeStatusValues } from "@/lib/validation/initiative";
import { findDirectConversation } from "@/server/queries/messages";
import {
  searchInitiatives,
  type InitiativeFilters,
  type InitiativeSearchResult,
} from "@/server/queries/initiatives";

export async function loadMoreInitiatives(
  filters: InitiativeFilters,
): Promise<InitiativeSearchResult> {
  return searchInitiatives(filters);
}

export interface InitiativeActionState {
  error?: string;
}

function parseInitiativeForm(formData: FormData) {
  return initiativeSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description"),
    topic: formData.get("topic"),
    region: formData.get("region"),
    activityType: formData.get("activityType"),
    locationId: formData.get("locationId"),
    latitude: formData.get("latitude"),
    longitude: formData.get("longitude"),
  });
}

export async function createInitiative(
  locale: Locale,
  _prevState: InitiativeActionState,
  formData: FormData,
): Promise<InitiativeActionState> {
  const parsed = parseInitiativeForm(formData);
  if (!parsed.success) return { error: "invalid" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "unauthenticated" };

  const { data: initiative, error } = await supabase
    .from("initiatives")
    .insert({
      author_id: user.id,
      title: parsed.data.title,
      description: parsed.data.description,
      topic: parsed.data.topic,
      region: parsed.data.region,
      activity_type: parsed.data.activityType,
      location_id: parsed.data.locationId ?? null,
      latitude: parsed.data.latitude ?? null,
      longitude: parsed.data.longitude ?? null,
    })
    .select("id")
    .single();

  if (error) return { error: "generic" };

  revalidatePath(`/${locale}/initiatives`);
  return redirect({ href: `/initiatives/${initiative.id}`, locale });
}

export interface InitiativeStatusResult {
  error?: "unauthenticated" | "generic";
}

export async function updateInitiativeStatus(
  locale: Locale,
  initiativeId: string,
  status: (typeof initiativeStatusValues)[number],
): Promise<InitiativeStatusResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "unauthenticated" };

  const { error } = await supabase
    .from("initiatives")
    .update({ status })
    .eq("id", initiativeId)
    .eq("author_id", user.id);
  if (error) return { error: "generic" };

  revalidatePath(`/${locale}/account/initiatives`);
  revalidatePath(`/${locale}/initiatives/${initiativeId}`);
  return {};
}

export interface DeleteInitiativeResult {
  error?: "unauthenticated" | "generic";
}

export async function deleteInitiative(
  locale: Locale,
  initiativeId: string,
): Promise<DeleteInitiativeResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "unauthenticated" };

  const { error } = await supabase
    .from("initiatives")
    .delete()
    .eq("id", initiativeId)
    .eq("author_id", user.id);
  if (error) return { error: "generic" };

  revalidatePath(`/${locale}/account/initiatives`);
  revalidatePath(`/${locale}/initiatives`);
  return {};
}

export interface RespondActionState {
  error?: "unauthenticated" | "invalid" | "ownInitiative" | "generic";
  success?: boolean;
}

/**
 * Records a structured response (participation/collaboration/info_request) and,
 * in the same step, opens or reuses a direct conversation with the initiative's
 * author — this is how BRD §6 "установление контактов" is wired to a response.
 */
export async function respondToInitiative(
  locale: Locale,
  initiativeId: string,
  _prevState: RespondActionState,
  formData: FormData,
): Promise<RespondActionState> {
  const parsed = initiativeResponseSchema.safeParse({
    initiativeId,
    type: formData.get("type"),
    message: formData.get("message"),
  });
  if (!parsed.success) return { error: "invalid" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "unauthenticated" };

  const { data: initiative, error: initiativeError } = await supabase
    .from("initiatives")
    .select("author_id")
    .eq("id", parsed.data.initiativeId)
    .maybeSingle();
  if (initiativeError) return { error: "generic" };
  if (!initiative) return { error: "invalid" };
  if (initiative.author_id === user.id) return { error: "ownInitiative" };

  const { error: responseError } = await supabase.from("initiative_responses").insert({
    initiative_id: parsed.data.initiativeId,
    responder_id: user.id,
    type: parsed.data.type,
    message: parsed.data.message || null,
  });
  // 23505 = already responded once — not fatal, fall through so a retry after a
  // partial failure below can still finish opening the conversation.
  if (responseError && responseError.code !== "23505") return { error: "generic" };

  let conversationId = await findDirectConversation(user.id, initiative.author_id);
  if (!conversationId) {
    const { data: conversation, error: conversationError } = await supabase
      .from("conversations")
      .insert({})
      .select("id")
      .single();
    if (conversationError) return { error: "generic" };
    conversationId = conversation.id;

    // Self first: conversation_participants' insert policy allows adding someone
    // else only once the inserting user is already a participant of that conversation.
    const { error: selfParticipantError } = await supabase
      .from("conversation_participants")
      .insert({ conversation_id: conversationId, profile_id: user.id });
    if (selfParticipantError) return { error: "generic" };

    const { error: authorParticipantError } = await supabase
      .from("conversation_participants")
      .insert({ conversation_id: conversationId, profile_id: initiative.author_id });
    if (authorParticipantError) return { error: "generic" };
  }

  if (parsed.data.message) {
    const { error: messageError } = await supabase.from("messages").insert({
      conversation_id: conversationId,
      sender_id: user.id,
      body: parsed.data.message,
    });
    if (messageError) return { error: "generic" };
  }

  revalidatePath(`/${locale}/initiatives/${parsed.data.initiativeId}`);
  revalidatePath(`/${locale}/account/messages`);
  return { success: true };
}
