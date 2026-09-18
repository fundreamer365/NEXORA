import { supabase } from "./supabase.js";
import { formatMessage, formatTime, formatDateLabel } from "./utils.js";

let realtimeChannel = null;
let currentChatId = null;
let currentMessages = [];

// ============================================================
// Получить или создать личный чат
// ============================================================
export async function openDirectChat(otherUserId) {
  const { data, error } = await supabase.rpc("get_or_create_direct_chat", {
    other_user: otherUserId,
  });
  if (error) throw error;
  return data; // chat_id
}

// ============================================================
// Список чатов текущего пользователя
// ============================================================
export async function listChats() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  // Получаем все чаты пользователя
  const { data: memberships, error: mErr } = await supabase
    .from("chat_members")
    .select("chat_id")
    .eq("user_id", user.id);
  if (mErr) throw mErr;
  if (!memberships.length) return [];

  const chatIds = memberships.map(m => m.chat_id);

  const { data: chats, error: cErr } = await supabase
    .from("chats")
    .select("id, is_group, title, updated_at")
    .in("id", chatIds);
  if (cErr) throw cErr;

  // Для каждого личного чата — собеседник
  const { data: allMembers, error: aErr } = await supabase
    .from("chat_members")
    .select("chat_id, user_id, profile:profiles!chat_members_user_id_fkey(id, username, nexora_id, avatar_url, is_online, show_online)")
    .in("chat_id", chatIds);
  if (aErr) throw aErr;

  // Последнее сообщение
  const { data: lastMsgs } = await supabase
    .from("messages")
    .select("chat_id, content, created_at, sender_id")
    .in("chat_id", chatIds)
    .order("created_at", { ascending: false });

  const lastByChat = {};
  (lastMsgs || []).forEach(m => { if (!lastByChat[m.chat_id]) lastByChat[m.chat_id] = m; });

  return chats.map(c => {
    const members = allMembers.filter(m => m.chat_id === c.id);
    const other = members.find(m => m.user_id !== user.id)?.profile || null;
    const last = lastByChat[c.id];
    return {
      id: c.id,
      is_group: c.is_group,
      title: c.title,
      updated_at: c.updated_at,
      other_user: other,
      last_message: last ? {
        content: last.content,
        created_at: last.created_at,
        is_own: last.sender_id === user.id,
      } : null,
    };
  }).sort((a, b) => {
    const ta = a.last_message?.created_at || a.updated_at;
    const tb = b.last_message?.created_at || b.updated_at;
    return new Date(tb) - new Date(ta);
  });
}

// ============================================================
// Загрузить сообщения чата
// ============================================================
export async function loadMessages(chatId, limit = 200) {
  const { data, error } = await supabase
    .from("messages")
    .select("id, chat_id, sender_id, content, edited_at, created_at, attachment_url, attachment_type")
    .eq("chat_id", chatId)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw error;
  return data;
}

// ============================================================
// Отправить сообщение
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
// Realtime подписка на сообщения чата
// ============================================================
export function subscribeToChat(chatId, handlers) {
  unsubscribeFromChat();
  currentChatId = chatId;

  realtimeChannel = supabase
    .channel("chat:" + chatId)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages", filter: `chat_id=eq.${chatId}` },
      payload => handlers.onInsert?.(payload.new)
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "messages", filter: `chat_id=eq.${chatId}` },
      payload => handlers.onUpdate?.(payload.new)
    )
    .on(
      "postgres_changes",
      { event: "DELETE", schema: "public", table: "messages", filter: `chat_id=eq.${chatId}` },
      payload => handlers.onDelete?.(payload.old)
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
// Realtime подписка на профили (online status)
// ============================================================
export function subscribeToProfiles(callback) {
  const ch = supabase
    .channel("profiles-watch")
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "profiles" },
      payload => callback(payload.new)
    )
    .subscribe();
  return ch;
}

// ============================================================
// Рендер одного сообщения в DOM
// ============================================================
export function renderMessage(msg, currentUserId, container, prevMsg) {
  // Разделитель даты
  if (!prevMsg || new Date(prevMsg.created_at).toDateString() !== new Date(msg.created_at).toDateString()) {
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

  const bubble = document.createElement("div");
  bubble.className = "msg-bubble";

  const content = document.createElement("div");
  content.className = "msg-content";
  content.innerHTML = formatMessage(msg.content);
  bubble.appendChild(content);

  const meta = document.createElement("div");
  meta.className = "msg-meta";
  if (msg.edited_at) {
    const ed = document.createElement("span");
    ed.className = "msg-edited";
    ed.textContent = "(edited)";
    meta.appendChild(ed);
  }
  const time = document.createElement("span");
  time.textContent = formatTime(msg.created_at);
  meta.appendChild(time);
  bubble.appendChild(meta);

  row.appendChild(bubble);

  if (isOwn) {
    const menuBtn = document.createElement("button");
    menuBtn.className = "msg-menu-btn";
    menuBtn.textContent = "⋯";
    menuBtn.title = "Actions";
    menuBtn.addEventListener("click", e => {
      e.stopPropagation();
      openMessageMenu(e, msg, row);
    });
    row.appendChild(menuBtn);
  }

  container.appendChild(row);
  return row;
}

// ============================================================
// Контекстное меню сообщения
// ============================================================
function openMessageMenu(event, msg, rowEl) {
  closeContextMenu();

  const menu = document.createElement("div");
  menu.className = "context-menu";
  menu.id = "ctx-menu";

  const editBtn = document.createElement("button");
  editBtn.textContent = "✎ Edit";
  editBtn.addEventListener("click", () => {
    closeContextMenu();
    startEditMessage(msg, rowEl);
  });
  menu.appendChild(editBtn);

  const delBtn = document.createElement("button");
  delBtn.className = "danger";
  delBtn.textContent = "🗑 Delete";
  delBtn.addEventListener("click", async () => {
    closeContextMenu();
    if (!confirm("Delete this message?")) return;
    try {
      await deleteMessage(msg.id);
      rowEl.remove();
    } catch (err) {
      alert("Error: " + err.message);
    }
  });
  menu.appendChild(delBtn);

  document.body.appendChild(menu);

  const rect = event.target.getBoundingClientRect();
  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;
  let left = rect.right - mw;
  let top = rect.bottom + 6;
  if (top + mh > window.innerHeight) top = rect.top - mh - 6;
  if (left < 8) left = 8;
  menu.style.left = left + "px";
  menu.style.top = top + "px";

  setTimeout(() => {
    document.addEventListener("click", closeContextMenu, { once: true });
  }, 0);
}

export function closeContextMenu() {
  const m = document.getElementById("ctx-menu");
  if (m) m.remove();
}

// ============================================================
// Inline edit
// ============================================================
function startEditMessage(msg, rowEl) {
  const contentDiv = rowEl.querySelector(".msg-content");
  const originalHtml = contentDiv.innerHTML;

  contentDiv.innerHTML = "";
  const ta = document.createElement("textarea");
  ta.value = msg.content;
  ta.style.minHeight = "60px";
  ta.style.background = "transparent";
  ta.style.border = "1px solid rgba(255,255,255,0.3)";
  ta.style.color = "inherit";
  contentDiv.appendChild(ta);
  ta.focus();
  ta.select();

  const saveBtn = document.createElement("button");
  saveBtn.textContent = "Save";
  saveBtn.className = "btn btn-primary";
  saveBtn.style.marginTop = "6px";
  saveBtn.style.padding = "4px 10px";
  saveBtn.style.fontSize = "12px";

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "Cancel";
  cancelBtn.className = "btn btn-ghost";
  cancelBtn.style.marginTop = "6px";
  cancelBtn.style.marginLeft = "6px";
  cancelBtn.style.padding = "4px 10px";
  cancelBtn.style.fontSize = "12px";

  contentDiv.appendChild(saveBtn);
  contentDiv.appendChild(cancelBtn);

  cancelBtn.addEventListener("click", () => { contentDiv.innerHTML = originalHtml; });

  saveBtn.addEventListener("click", async () => {
    const newContent = ta.value.trim();
    if (!newContent) return;
    if (newContent === msg.content) { contentDiv.innerHTML = originalHtml; return; }
    try {
      const updated = await editMessage(msg.id, newContent);
      contentDiv.innerHTML = formatMessage(updated.content);
      // Обновим meta: edited
      const meta = rowEl.querySelector(".msg-meta");
      meta.innerHTML = "";
      const ed = document.createElement("span");
      ed.className = "msg-edited";
      ed.textContent = "(edited)";
      meta.appendChild(ed);
      const time = document.createElement("span");
      time.textContent = formatTime(updated.created_at);
      meta.appendChild(time);
    } catch (err) {
      alert("Error: " + err.message);
      contentDiv.innerHTML = originalHtml;
    }
  });

  ta.addEventListener("keydown", e => {
    if (e.key === "Escape") cancelBtn.click();
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) saveBtn.click();
  });
}
