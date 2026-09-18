import { supabase } from "./supabase.js";

/**
 * Создаёт группу или канал.
 * @param {string} title
 * @param {string[]} memberIds  массив user id, включая себя или нет (себя добавим)
 * @param {'group'|'channel'} type
 * @param {string?} description
 * @returns {Promise<string>} chatId
 */
export async function createGroupChat(title, memberIds, type = "group", description = null) {
  const { data, error } = await supabase.rpc("create_group_chat", {
    p_title: title,
    p_member_ids: memberIds || [],
    p_type: type,
    p_description: description,
  });
  if (error) throw error;
  return data;
}

export async function addChatMember(chatId, userId) {
  const { error } = await supabase.rpc("add_chat_member", {
    p_chat_id: chatId,
    p_user_id: userId,
  });
  if (error) throw error;
}

export async function listChatMembers(chatId) {
  const { data, error } = await supabase.rpc("chat_members_with_profiles", {
    p_chat_id: chatId,
  });
  if (error) throw error;
  return data || [];
}

export async function updateChat(chatId, patch) {
  const { data, error } = await supabase
    .from("chats")
    .update(patch)
    .eq("id", chatId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function uploadChatAvatar(chatId, file) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  if (!file.type.startsWith("image/")) throw new Error("Only images allowed");
  if (file.size > 2 * 1024 * 1024) throw new Error("Max 2MB");

  const ext = (file.name.split(".").pop() || "png").toLowerCase();
  const path = `${user.id}/chat-${chatId}-${Date.now()}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from("avatars")
    .upload(path, file, { upsert: true, cacheControl: "3600" });
  if (upErr) throw upErr;

  const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
  const url = pub.publicUrl + "?t=" + Date.now();
  await updateChat(chatId, { avatar_url: url });
  return url;
}
