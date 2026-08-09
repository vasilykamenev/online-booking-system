"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { Locale } from "@/i18n/routing";
import { sendMessageSchema } from "@/lib/validation/message";

export interface SendMessageResult {
  error?: "unauthenticated" | "invalid" | "generic";
}

export async function sendMessage(
  locale: Locale,
  conversationId: string,
  _prevState: SendMessageResult,
  formData: FormData,
): Promise<SendMessageResult> {
  const parsed = sendMessageSchema.safeParse({
    conversationId,
    body: formData.get("body"),
  });
  if (!parsed.success) return { error: "invalid" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "unauthenticated" };

  const { error } = await supabase.from("messages").insert({
    conversation_id: parsed.data.conversationId,
    sender_id: user.id,
    body: parsed.data.body,
  });
  if (error) return { error: "generic" };

  revalidatePath(`/${locale}/account/messages/${conversationId}`);
  revalidatePath(`/${locale}/account/messages`);
  return {};
}
