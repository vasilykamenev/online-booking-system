import "server-only";
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

export interface ConversationSummary {
  id: string;
  otherParticipantNames: string[];
  lastMessage: { body: string; createdAt: string; senderId: string } | null;
  createdAt: string;
}

export async function getConversations(profileId: string): Promise<ConversationSummary[]> {
  const supabase = await createClient();

  const { data: participantRows, error: participantError } = await supabase
    .from("conversation_participants")
    .select("conversation_id")
    .eq("profile_id", profileId);
  if (participantError) throw participantError;

  const conversationIds = (participantRows ?? []).map((row) => row.conversation_id);
  if (conversationIds.length === 0) return [];

  const { data, error } = await supabase
    .from("conversations")
    .select(
      `id, created_at,
       conversation_participants ( profile_id, profiles ( full_name ) ),
       messages ( body, sender_id, created_at )`,
    )
    .in("id", conversationIds);
  if (error) throw error;

  return (data ?? [])
    .map((conversation) => {
      const others = conversation.conversation_participants
        .filter((participant) => participant.profile_id !== profileId)
        .map((participant) => participant.profiles?.full_name ?? null)
        .filter((name): name is string => name !== null);

      const lastMessage = [...conversation.messages].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      )[0];

      return {
        id: conversation.id,
        otherParticipantNames: others,
        lastMessage: lastMessage
          ? {
              body: lastMessage.body,
              createdAt: lastMessage.created_at,
              senderId: lastMessage.sender_id,
            }
          : null,
        createdAt: conversation.created_at,
      };
    })
    .sort((a, b) => {
      const aTime = new Date(a.lastMessage?.createdAt ?? a.createdAt).getTime();
      const bTime = new Date(b.lastMessage?.createdAt ?? b.createdAt).getTime();
      return bTime - aTime;
    });
}

export interface ConversationThread {
  id: string;
  otherParticipantNames: string[];
  messages: { id: string; body: string; senderId: string; createdAt: string }[];
}

export const getConversationById = cache(
  async (conversationId: string, viewerId: string): Promise<ConversationThread | null> => {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("conversations")
      .select(
        `id,
         conversation_participants ( profile_id, profiles ( full_name ) ),
         messages ( id, body, sender_id, created_at )`,
      )
      .eq("id", conversationId)
      .maybeSingle();

    if (error) {
      if (error.code === "22P02") return null;
      throw error;
    }
    if (!data) return null;

    // Defense in depth — RLS already keeps non-participants from getting this row at all.
    const isParticipant = data.conversation_participants.some(
      (participant) => participant.profile_id === viewerId,
    );
    if (!isParticipant) return null;

    const others = data.conversation_participants
      .filter((participant) => participant.profile_id !== viewerId)
      .map((participant) => participant.profiles?.full_name ?? null)
      .filter((name): name is string => name !== null);

    const messages = [...data.messages].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );

    return {
      id: data.id,
      otherParticipantNames: others,
      messages: messages.map((message) => ({
        id: message.id,
        body: message.body,
        senderId: message.sender_id,
        createdAt: message.created_at,
      })),
    };
  },
);

/** Finds an existing 1:1 conversation between two profiles, if any — avoids spawning duplicates on repeat contact.
 * Accepts an existing client (e.g. the admin/service-role one already in scope at a system-message call site). */
export async function findDirectConversation(
  profileAId: string,
  profileBId: string,
  client?: SupabaseClient<Database>,
): Promise<string | null> {
  const supabase = client ?? (await createClient());

  const { data: ownRows, error: ownError } = await supabase
    .from("conversation_participants")
    .select("conversation_id")
    .eq("profile_id", profileAId);
  if (ownError) throw ownError;

  const candidateIds = (ownRows ?? []).map((row) => row.conversation_id);
  if (candidateIds.length === 0) return null;

  const { data: matches, error: matchError } = await supabase
    .from("conversation_participants")
    .select("conversation_id")
    .eq("profile_id", profileBId)
    .in("conversation_id", candidateIds);
  if (matchError) throw matchError;

  return matches?.[0]?.conversation_id ?? null;
}
