import { supabase } from "./supabase.js";
import { formatMessage, formatTime, formatDateLabel, escapeHtml } from "./utils.js";
import { humanFileSize } from "./upload.js";
import { getSystemStickerById } from "./stickers.js";

let realtimeChannel = null;
let currentChatId = null;

const messagesStore = new Map();
export function cacheMessage(m) { messagesStore.set(m.id, m); }
export function getCachedMessage(id) { return messagesStore.get(id); }

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
    .select("id, is_group, title, type, description, avatar_url, updated_at, owner_id")
    .in("id", chatIds);
  if (cErr) throw cErr;

  const { data: allMembers, error: aErr } = await supabase
    .from("chat_members")
    .select("chat_id, user_id, role, profile:profiles!chat_members_user_id_fkey(id, username, nexora_id, avatar_url, system_avatar, is_online, show_online)")
    .in("chat_id", chatIds);
  if (aErr) throw aErr;

  const { data: lastMsgs } = await supabase
    .from("messages")
    .select("chat_id, content, created_at, sender_id, kind")
    .in("chat_id", chatIds)
    .order("created_at", { ascending: false });

  const lastByChat = {};
  (lastMsgs || []).forEach((m) => {
    if (!lastByChat[m.chat_id]) lastByChat[m.chat_id] = m;
  });

  return chats.map((c) => {
    const members = allMembers.filter((m) => m.chat_id === c.id);
    const others = members.filter((m) => m.user_id !== user.id);
    const myMembership = members.find((m) => m.user_id === user.id);
    const last = lastByChat[c.id];

    return {
      id: c.id,
      is_group: c.is_group,
      type: c.type || (c.is_group ? "group" : "direct"),
      title: c.title,
      description: c.description,
      avatar_url: c.avatar_url,
      owner_id: c.owner_id,
      updated_at: c.updated_at,
      my_role: myMembership ? myMembership.role : "member",
      members,
      other_user: others.length ? others[0].profile : null,
      display_title:
        c.type === "direct" || (!c.is_group && others.length)
          ? (others[0] ? others[0].profile.username : "Chat")
          : (c.title || "Group"),
      last_message: last
        ? {
            content: last.content,
            kind: last.kind,
            created_at: last.created_at,
            is_own: last.sender_id === user.id,
          }
        : null,
    };
  }).sort((a, b) => {
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
    .select("id, chat_id, sender_id, content, kind, sticker_id, attachment_url, attachment_type, file_name, file_size, edited_at, created_at, reply_to")
    .eq("chat_id", chatId)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw error;
  return data;
}

// ============================================================
// Отправка сообщения
// ============================================================
export async function sendMessage(chatId, content) {
  const trimmed = String(content || "").trim();
  if (!trimmed) throw new Error("Empty message");
  if (trimmed.length > 4000) throw new Error("Message too long (max 4000)");

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("messages")
    .insert({ chat_id: chatId, sender_id: user.id, content: trimmed, kind: "text" })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function sendAttachmentMessage(chatId, attachment, caption = "") {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("messages")
    .insert({
      chat_id: chatId,
      sender_id: user.id,
      content: caption.slice(0, 4000),
      kind: attachment.kind,
      attachment_url: attachment.url,
      attachment_type: attachment.kind,
      file_name: attachment.name,
      file_size: attachment.size || null,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function sendStickerMessage(chatId, stickerId, stickerUrl) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  // Для системных стикеров сохраняем только id (URL перегенерируется на клиенте)
  // Для кастомных — id + url (но мы всё равно умеем по id получить из БД)
  const { data, error } = await supabase
    .from("messages")
    .insert({
      chat_id: chatId,
      sender_id: user.id,
      content: "",
      kind: "sticker",
      sticker_id: stickerId,
    })
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
// Realtime
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
// Рендер сообщения
// ============================================================
export function renderMessage(msg, currentUserId, container, prevMsg, opts = {}) {
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
  bubble.className = "msg-bubble";

  // Имя отправителя в группе
  if (!isOwn && opts.showSender && opts.senderName) {
    const sn = document.createElement("div");
    sn.className = "msg-sender";
    sn.textContent = opts.senderName;
    bubble.appendChild(sn);
  }

  const content = document.createElement("div");
  content.className = "msg-content";
  renderMessageBody(content, msg);
  bubble.appendChild(content);

  // Реакции
  const reactionsBox = document.createElement("div");
  reactionsBox.className = "msg-reactions";
  reactionsBox.dataset.reactionsFor = msg.id;
  bubble.appendChild(reactionsBox);

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

  if (isOwn && msg.kind === "text") {
    const menuBtn = document.createElement("button");
    menuBtn.className = "msg-menu-btn";
    menuBtn.textContent = "⋯";
    menuBtn.title = "Actions";
    menuBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openMessageMenu(e, msg, row, currentUserId);
    });
    row.appendChild(menuBtn);
  } else if (!isOwn) {
    // Для чужих сообщений — меню реакций
    const menuBtn = document.createElement("button");
    menuBtn.className = "msg-menu-btn";
    menuBtn.textContent = "⋯";
    menuBtn.title = "React";
    menuBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openMessageMenu(e, msg, row, currentUserId);
    });
    row.appendChild(menuBtn);
  }

  cacheMessage(msg);
  container.appendChild(row);
  return row;
}

function renderMessageBody(contentEl, msg) {
  contentEl.innerHTML = "";

  if (msg.kind === "sticker") {
    const sys = getSystemStickerById(msg.sticker_id);
    const img = document.createElement("img");
    img.className = "msg-sticker";
    img.alt = "sticker";
    if (sys) {
      img.src = sys.svg;
    } else {
      // Кастомный стикер: id хранится в sticker_id, url — надо найти в БД.
      // Простейший путь: покажем из attachment_url, если есть; иначе — плейсхолдер.
      if (msg.attachment_url) img.src = msg.attachment_url;
      else {
        img.remove();
        const ph = document.createElement("div");
        ph.textContent = "🎨";
        ph.style.fontSize = "48px";
        contentEl.appendChild(ph);
        return;
      }
    }
    contentEl.appendChild(img);
    if (msg.content) {
      const cap = document.createElement("div");
      cap.style.marginTop = "4px";
      cap.innerHTML = formatMessage(msg.content);
      contentEl.appendChild(cap);
    }
    return;
  }

  if (msg.kind === "image" && msg.attachment_url) {
    const img = document.createElement("img");
    img.className = "msg-image";
    img.src = msg.attachment_url;
    img.alt = msg.file_name || "image";
    img.loading = "lazy";
    img.addEventListener("click", () => openLightbox(msg.attachment_url, "image"));
    contentEl.appendChild(img);
    if (msg.content) {
      const cap = document.createElement("div");
      cap.innerHTML = formatMessage(msg.content);
      contentEl.appendChild(cap);
    }
    return;
  }

  if (msg.kind === "video" && msg.attachment_url) {
    const video = document.createElement("video");
    video.className = "msg-video";
    video.src = msg.attachment_url;
    video.controls = true;
    video.preload = "metadata";
    video.addEventListener("dblclick", () => openLightbox(msg.attachment_url, "video"));
    contentEl.appendChild(video);
    if (msg.content) {
      const cap = document.createElement("div");
      cap.innerHTML = formatMessage(msg.content);
      contentEl.appendChild(cap);
    }
    return;
  }

  if (msg.kind === "file" && msg.attachment_url) {
    const a = document.createElement("a");
    a.className = "msg-file";
    a.href = msg.attachment_url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.download = msg.file_name || "";
    const icon = document.createElement("div");
    icon.className = "msg-file-icon";
    icon.textContent = pickFileIcon(msg.file_name);
    const body = document.createElement("div");
    body.className = "msg-file-body";
    const name = document.createElement("div");
    name.className = "msg-file-name";
    name.textContent = msg.file_name || "File";
    const size = document.createElement("div");
    size.className = "msg-file-size";
    size.textContent = humanFileSize(msg.file_size);
    body.appendChild(name);
    body.appendChild(size);
    a.appendChild(icon);
    a.appendChild(body);
    contentEl.appendChild(a);
    if (msg.content) {
      const cap = document.createElement("div");
      cap.style.marginTop = "4px";
      cap.innerHTML = formatMessage(msg.content);
      contentEl.appendChild(cap);
    }
    return;
  }

  // Обычный текст
  contentEl.innerHTML = formatMessage(msg.content || "");
}

function pickFileIcon(name) {
  if (!name) return "📄";
  const ext = name.split(".").pop().toLowerCase();
  if (["zip","rar","7z","tar","gz"].includes(ext)) return "🗜️";
  if (["pdf"].includes(ext)) return "📕";
  if (["doc","docx","rtf","odt"].includes(ext)) return "📘";
  if (["xls","xlsx","csv","ods"].includes(ext)) return "📗";
  if (["ppt","pptx","odp"].includes(ext)) return "📙";
  if (["mp3","wav","ogg","flac","m4a"].includes(ext)) return "🎵";
  if (["mp4","mov","avi","mkv","webm"].includes(ext)) return "🎬";
  if (["js","ts","py","java","c","cpp","go","rs","rb","php","html","css","json","xml"].includes(ext)) return "💻";
  return "📄";
}

function openLightbox(url, kind) {
  const lb = document.createElement("div");
  lb.className = "lightbox";
  let node;
  if (kind === "video") {
    node = document.createElement("video");
    node.src = url;
    node.controls = true;
    node.autoplay = true;
  } else {
    node = document.createElement("img");
    node.src = url;
  }
  const close = document.createElement("button");
  close.className = "lightbox-close";
  close.textContent = "×";
  close.addEventListener("click", (e) => { e.stopPropagation(); lb.remove(); });
  lb.appendChild(node);
  lb.appendChild(close);
  lb.addEventListener("click", () => lb.remove());
  document.body.appendChild(lb);
}

// ============================================================
// Контекстное меню
// ============================================================
function openMessageMenu(event, msg, rowEl, currentUserId) {
  closeContextMenu();

  const isOwn = msg.sender_id === currentUserId;
  const menu = document.createElement("div");
  menu.className = "context-menu";
  menu.id = "ctx-menu";

  // Реакции
  const reactionsBar = document.createElement("div");
  reactionsBar.className = "reaction-bar";
  reactionsBar.style.marginBottom = "4px";
  import("./reactions.js").then(({ quickReactions }) => {
    quickReactions().forEach(emoji => {
      const b = document.createElement("button");
      b.textContent = emoji;
      b.addEventListener("click", async () => {
        closeContextMenu();
        try {
          const { toggleReaction } = await import("./reactions.js");
          await toggleReaction(msg.id, emoji, currentUserId);
        } catch (e) { console.error(e); }
      });
      reactionsBar.appendChild(b);
    });
  });
  menu.appendChild(reactionsBar);

  if (isOwn && msg.kind === "text") {
    const editBtn = document.createElement("button");
    editBtn.textContent = "✎ Edit";
    editBtn.addEventListener("click", () => {
      closeContextMenu();
      startEditMessage(msg, rowEl);
    });
    menu.appendChild(editBtn);
  }

  const copyBtn = document.createElement("button");
  copyBtn.textContent = "📋 Copy";
  copyBtn.addEventListener("click", () => {
    closeContextMenu();
    navigator.clipboard.writeText(msg.content || msg.attachment_url || "");
  });
  menu.appendChild(copyBtn);

  if (isOwn) {
    const delBtn = document.createElement("button");
    delBtn.className = "danger";
    delBtn.textContent = "🗑 Delete";
    delBtn.addEventListener("click", async () => {
      closeContextMenu();
      if (!confirm("Delete this message?")) return;
      try {
        await deleteMessage(msg.id);
        rowEl.remove();
      } catch (err) { alert("Error: " + err.message); }
    });
    menu.appendChild(delBtn);
  }

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
      const meta = rowEl.querySelector(".msg-meta");
      meta.innerHTML = "";
      const ed = document.createElement("span");
      ed.className = "msg-edited";
      ed.textContent = "(edited)";
      meta.appendChild(ed);
      const time = document.createElement("span");
      time.textContent = formatTime(updated.created_at);
      meta.appendChild(time);
      cacheMessage(updated);
    } catch (err) {
      alert("Error: " + err.message);
      contentDiv.innerHTML = originalHtml;
    }
  });

  ta.addEventListener("keydown", (e) => {
    if (e.key === "Escape") cancelBtn.click();
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) saveBtn.click();
  });
}

void escapeHtml;
