import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { findDirectConversation } from "@/server/queries/messages";

/** Opens (or reuses) the 1:1 conversation between two profiles and drops a message into it —
 * the in-portal notification channel for the booking payment-method handshake. Runs with
 * whichever client the caller passes: the acting user's session client keeps `sender_id`
 * as the real actor (client declaring a method, owner confirming). */
export async function sendBookingMessage(
  client: SupabaseClient<Database>,
  { fromId, toId, body }: { fromId: string; toId: string; body: string },
): Promise<void> {
  let conversationId = await findDirectConversation(fromId, toId, client);

  if (!conversationId) {
    const { data: conversation, error: conversationError } = await client
      .from("conversations")
      .insert({})
      .select("id")
      .single();
    if (conversationError) throw conversationError;
    conversationId = conversation.id;

    // Self first: conversation_participants' insert policy allows adding someone
    // else only once the inserting user is already a participant of that conversation.
    const { error: selfParticipantError } = await client
      .from("conversation_participants")
      .insert({ conversation_id: conversationId, profile_id: fromId });
    if (selfParticipantError) throw selfParticipantError;

    const { error: otherParticipantError } = await client
      .from("conversation_participants")
      .insert({ conversation_id: conversationId, profile_id: toId });
    if (otherParticipantError) throw otherParticipantError;
  }

  const { error: messageError } = await client.from("messages").insert({
    conversation_id: conversationId,
    sender_id: fromId,
    body,
  });
  if (messageError) throw messageError;
}
