import { supabase } from "./supabase.js";
import { formatMessage, formatTime, formatDateLabel } from "./utils.js";

let realtimeChannel = null;
let currentChatId = null;

// Хранилище сообщений по id (для доступа к данным из DOM)
const messagesStore = new Map();
export function cacheMessage(m) {
  messagesStore.set(m.id, m);
}
export function getCachedMessage(id) {
  return messagesStore.get(id);
}

// ============================================================
// Открыть/создать личный чат
// ============================================================
export async function openDirectChat(otherUserId) {
  const { data, error } = await supabase.rpc("get_or_create_direct_chat", {
    other_user: otherUserId,
  });
  if (error) throw error;
  return data;
}

// ============================================================
// Список чатов
// ============================================================
export async function listChats() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data: memberships, error: mErr } = await supabase
    .from("chat_members")
    .select("chat_id")
    .eq("user_id", user.id);
  if (mErr) throw mErr;
  if (!memberships.length) return [];

  const chatIds = memberships.map((m) => m.chat_id);

  const { data: chats, error: cErr } = await supabase
    .from("chats")
    .select("id, is_group, title, updated_at")
    .in("id", chatIds);
  if (cErr) throw cErr;

  const { data: allMembers, error: aErr } = await supabase
    .from("chat_members")
    .select(
      "chat_id, user_id, profile:profiles!chat_members_user_id_fkey(id, username, nexora_id, avatar_url, is_online, show_online)"
    )
    .in("chat_id", chatIds);
  if (aErr) throw aErr;

  const { data: lastMsgs } = await supabase
    .from("messages")
    .select("chat_id, content, created_at, sender_id")
    .in("chat_id", chatIds)
    .order("created_at", { ascending: false });

  const lastByChat = {};
  (lastMsgs || []).forEach((m) => {
    if (!lastByChat[m.chat_id]) lastByChat[m.chat_id] = m;
  });

  return chats
    .map((c) => {
      const members = allMembers.filter((m) => m.chat_id === c.id);
      const other = members.find((m) => m.user_id !== user.id);
      const last = lastByChat[c.id];
      return {
        id: c.id,
        is_group: c.is_group,
        title: c.title,
        updated_at: c.updated_at,
        other_user: other ? other.profile : null,
        last_message: last
          ? {
              content: last.content,
              created_at: last.created_at,
              is_own: last.sender_id === user.id,
            }
          : null,
      };
    })
    .sort((a, b) => {
      const ta = a.last_message ? a.last_message.created_at : a.updated_at;
      const tb = b.last_message ? b.last_message.created_at : b.updated_at;
      return new Date(tb) - new Date(ta);
    });
}

// ============================================================
// Загрузить сообщения
// ============================================================
export async function loadMessages(chatId, limit = 200) {
  const { data, error } = await supabase
    .from("messages")
    .select(
      "id, chat_id, sender_id, content, edited_at, created_at, attachment_url, attachment_type"
    )
    .eq("chat_id", chatId)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw error;
  return data;
}

// ============================================================
// Отправка
// ============================================================
export async function sendMessage(chatId, content) {
  const trimmed = String(content || "").trim();
  if (!trimmed) throw new Error("Empty message");
  if (trimmed.length > 4000) throw new Error("Message too long (max 4000)");

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("messages")
    .insert({ chat_id: chatId, sender_id: user.id, content: trimmed })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function editMessage(messageId, newContent) {
  const trimmed = String(newContent || "").trim();
  if (!trimmed) throw new Error("Empty message");
  if (trimmed.length > 4000) throw new Error("Too long");

  const { data, error } = await supabase
    .from("messages")
    .update({ content: trimmed, edited_at: new Date().toISOString() })
    .eq("id", messageId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteMessage(messageId) {
  const { error } = await supabase.from("messages").delete().eq("id", messageId);
  if (error) throw error;
}

// ============================================================
// Realtime: сообщения чата
// ============================================================
export function subscribeToChat(chatId, handlers) {
  unsubscribeFromChat();
  currentChatId = chatId;

  realtimeChannel = supabase
    .channel("chat:" + chatId)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages", filter: `chat_id=eq.${chatId}` },
      (payload) => handlers.onInsert && handlers.onInsert(payload.new)
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "messages", filter: `chat_id=eq.${chatId}` },
      (payload) => handlers.onUpdate && handlers.onUpdate(payload.new)
    )
    .on(
      "postgres_changes",
      { event: "DELETE", schema: "public", table: "messages", filter: `chat_id=eq.${chatId}` },
      (payload) => handlers.onDelete && handlers.onDelete(payload.old)
    )
    .subscribe();
  return realtimeChannel;
}

export function unsubscribeFromChat() {
  if (realtimeChannel) {
    supabase.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
  currentChatId = null;
}

// ============================================================
// Realtime: профили (online status)
// ============================================================
export function subscribeToProfiles(callback) {
  return supabase
    .channel("profiles-watch")
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "profiles" },
      (payload) => callback(payload.new)
    )
    .subscribe();
}

// ============================================================
// Рендер одного сообщения
// ============================================================
export function renderMessage(msg, currentUserId, container, prevMsg) {
  if (
    !prevMsg ||
    new Date(prevMsg.created_at).toDateString() !==
      new Date(msg.created_at).toDateString()
  ) {
    const sep = document.createElement("div");
    sep.className = "date-sep";
    sep.textContent = formatDateLabel(msg.created_at);
    container.appendChild(sep);
  }

  const isOwn = msg.sender_id === currentUserId;

  const row = document.createElement("div");
  row.className = "msg-row" + (isOwn ? " own" : "");
  row.dataset.messageId = msg.id;
  row.dataset.senderId = msg.sender_id;
  row.dataset.createdAt = msg.created_at;

  const bubble = document.createElement("div");
  bubble.className = "msg-b
