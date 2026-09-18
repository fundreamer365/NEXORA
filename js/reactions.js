import { supabase } from "./supabase.js";

const QUICK = ["👍", "❤️", "😂", "🔥", "😮", "😢"];

export function quickReactions() { return QUICK; }

export async function loadReactionsForChat(chatId) {
  // Получаем id всех сообщений чата (или всех реакций, у которых message в этом чате)
  const { data, error } = await supabase
    .from("reactions")
    .select("message_id, user_id, emoji, messages!inner(chat_id)")
    .eq("messages.chat_id", chatId);
  if (error) throw error;

  const byMessage = {};
  (data || []).forEach(r => {
    if (!byMessage[r.message_id]) byMessage[r.message_id] = {};
    if (!byMessage[r.message_id][r.emoji]) byMessage[r.message_id][r.emoji] = [];
    byMessage[r.message_id][r.emoji].push(r.user_id);
  });
  return byMessage;
}

export async function toggleReaction(messageId, emoji, currentUserId) {
  // Есть ли уже моя реакция этим эмодзи?
  const { data: existing } = await supabase
    .from("reactions")
    .select("message_id")
    .eq("message_id", messageId)
    .eq("user_id", currentUserId)
    .eq("emoji", emoji)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from("reactions")
      .delete()
      .eq("message_id", messageId)
      .eq("user_id", currentUserId)
      .eq("emoji", emoji);
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from("reactions")
      .insert({ message_id: messageId, user_id: currentUserId, emoji });
    if (error) throw error;
  }
}

export function subscribeToReactions(chatId, onChange) {
  return supabase
    .channel("reactions:" + chatId)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "reactions" },
      (payload) => onChange(payload)
    )
    .subscribe();
}
