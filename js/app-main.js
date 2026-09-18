import { supabase } from "./supabase.js";
import {
  toast, initTheme, avatarNode, debounce, formatTime, formatMessage,
  escapeHtml, initials,
} from "./utils.js";
import {
  getSession, getCurrentProfile, logout, setOnlineStatus,
} from "./auth.js";
import {
  searchUserByQuery, updateProfile, uploadAvatar, setSystemAvatar,
} from "./profile.js";
import {
  listContacts, addContact,
} from "./contacts.js";
import {
  openDirectChat, listChats, loadMessages, sendMessage,
  sendAttachmentMessage, sendStickerMessage,
  subscribeToChat, unsubscribeFromChat, renderMessage,
  subscribeToProfiles, closeContextMenu, getCachedMessage,
} from "./chat.js";
import {
  listFactors, enrollTotp, verifyTotp, unenrollFactor, changePassword,
  listActiveSessionInfo,
} from "./security.js";
import { EMOJI_CATEGORIES } from "./emoji.js";
import { buildSystemAvatars } from "./avatars.js";
import {
  listSystemStickers, listCustomStickers, uploadSticker, deleteSticker,
} from "./stickers.js";
import { uploadAttachment, humanFileSize } from "./upload.js";
import {
  createGroupChat, addChatMember, listChatMembers, updateChat, uploadChatAvatar,
} from "./groups.js";
import { loadReactionsForChat, toggleReaction } from "./reactions.js";

// ============================================================
// State
// ============================================================
const state = {
  user: null,
  profile: null,
  activeChatId: null,
  activeChatPeer: null,
  activeChat: null,
  chats: [],
  contacts: [],
  activeTab: "chats",
  searchQuery: "",
  profileSubChannel: null,
  reactionsSubChannel: null,
  reactionsByMessage: {}, // { [msgId]: { emoji: [userId,...] } }
  membersByChat: {},      // { [chatId]: [...] }
  pendingAttachment: null,
};

// ============================================================
// Boot
// ============================================================
initTheme();
document.addEventListener("DOMContentLoaded", boot);

async function boot() {
  const session = await getSession();
  if (!session) { window.location.href = "login.html"; return; }
  state.user = session.user;

  try { state.profile = await getCurrentProfile(); }
  catch (e) { toast("Failed to load profile: " + e.message, "error"); return; }
  if (!state.profile) { await logout(); return; }

  await setOnlineStatus(true).catch(() => {});

  window.addEventListener("beforeunload", () => {
    supabase.from("profiles").update({ is_online: false }).eq("id", state.user.id);
  });
  document.addEventListener("visibilitychange", () => {
    setOnlineStatus(!document.hidden).catch(() => {});
  });

  renderSidebarFooter();
  await refreshChats();
  await refreshContacts();
  state.profileSubChannel = subscribeToProfiles(onProfileUpdate);

  bindEvents();
  renderWelcome();
}

// ============================================================
// Bindings
// ============================================================
function bindEvents() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.activeTab = btn.dataset.tab;
      renderSidebarBody();
    });
  });

  const searchInput = document.getElementById("sidebar-search");
  searchInput.addEventListener("input", debounce((e) => {
    state.searchQuery = e.target.value.trim();
    renderSidebarBody();
  }, 200));

  document.getElementById("sidebar-footer").addEventListener("click", openProfilePanel);
  document.getElementById("new-chat-btn").addEventListener("click", openNewChatDialog);

  const composer = document.getElementById("composer-input");
  const sendBtn = document.getElementById("send-btn");
  if (composer && sendBtn) {
    composer.addEventListener("input", () => autoResize(composer));
    composer.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendBtn.click(); }
    });
    sendBtn.addEventListener("click", onSendMessage);
  }

  document.getElementById("emoji-btn").addEventListener("click", (e) => {
    e.stopPropagation(); toggleEmojiPicker();
  });
  document.getElementById("sticker-btn").addEventListener("click", (e) => {
    e.stopPropagation(); toggleStickerPicker();
  });
  document.getElementById("attach-btn").addEventListener("click", () => {
    document.getElementById("attach-input").click();
  });
  document.getElementById("attach-input").addEventListener("change", onAttachPick);

  const mobileBtn = document.getElementById("mobile-menu-btn");
  if (mobileBtn) mobileBtn.addEventListener("click", () => {
    document.getElementById("sidebar").classList.remove("hidden-mobile");
  });
  const sidebar = document.getElementById("sidebar");
  sidebar.addEventListener("click", (e) => {
    if (window.innerWidth <= 860 && e.target.closest(".list-item")) {
      sidebar.classList.add("hidden-mobile");
    }
  });

  document.addEventListener("click", (e) => {
    closeContextMenu();
    // Закрываем пикер, если клик вне
    const picker = document.getElementById("picker");
    if (picker && !picker.contains(e.target) &&
        !e.target.closest("#emoji-btn") && !e.target.closest("#sticker-btn")) {
      picker.remove();
    }
  });
}

function autoResize(ta) {
  ta.style.height = "auto";
  ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
}

// ============================================================
// Sidebar
// ============================================================
function renderSidebarFooter() {
  const el = document.getElementById("sidebar-footer");
  if (!el) return;
  el.innerHTML = "";

  const wrap = document.createElement("div");
  wrap.className = "avatar-wrap";
  const av = avatarNode(state.profile, "md");
  wrap.appendChild(av);
  const dot = document.createElement("span");
  dot.className = "online-dot online";
  wrap.appendChild(dot);

  const body = document.createElement("div");
  body.className = "sidebar-footer-body";
  const name = document.createElement("div");
  name.className = "sidebar-footer-name";
  name.textContent = state.profile.username;
  const id = document.createElement("div");
  id.className = "sidebar-footer-id";
  id.textContent = state.profile.nexora_id;
  body.appendChild(name);
  body.appendChild(id);

  const settingsBtn = document.createElement("button");
  settingsBtn.className = "btn-icon";
  settingsBtn.textContent = "⚙";
  settingsBtn.title = "Settings";
  settingsBtn.addEventListener("click", (e) => { e.stopPropagation(); openSettingsPanel(); });

  el.appendChild(wrap);
  el.appendChild(body);
  el.appendChild(settingsBtn);
}

function renderSidebarBody() {
  const body = document.getElementById("sidebar-body");
  body.innerHTML = "";

  if (state.searchQuery) { renderSearchResults(body, state.searchQuery); return; }

  if (state.activeTab === "chats") renderChatsList(body);
  else renderContactsList(body);
}

async function renderSearchResults(container, query) {
  const loading = document.createElement("div");
  loading.className = "empty-state";
  loading.innerHTML = '<span class="spinner"></span>';
  container.appendChild(loading);

  let result = null;
  try { result = await searchUserByQuery(query); }
  catch (e) {
    container.innerHTML = "";
    const err = document.createElement("div");
    err.className = "empty-state";
    err.textContent = "Search error: " + e.message;
    container.appendChild(err);
    return;
  }

  container.innerHTML = "";
  if (!result) {
    const e = document.createElement("div");
    e.className = "empty-state";
    e.textContent = "No user found for " + query;
    container.appendChild(e);
    return;
  }
  if (result.id === state.user.id) {
    const e = document.createElement("div");
    e.className = "empty-state";
    e.textContent = "That's you 🙂";
    container.appendChild(e);
    return;
  }
  container.appendChild(renderUserCard(result));
}

function renderUserCard(user) {
  const wrap = document.createElement("div");
  wrap.className = "search-result";

  const av = avatarNode(user, "md");
  const body = document.createElement("div");
  body.className = "search-result-body";

  const name = document.createElement("div");
  name.className = "search-result-name";
  name.textContent = user.username;
  const id = document.createElement("div");
  id.className = "search-result-id";
  id.textContent = user.nexora_id;
  body.appendChild(name);
  body.appendChild(id);

  const btn = document.createElement("button");
  btn.className = "btn btn-primary";
  btn.textContent = "Message";
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';
    try {
      await addContact(user.id);
      await refreshContacts();
      const chatId = await openDirectChat(user.id);
      await refreshChats();
      await openChat(chatId);
      if (window.innerWidth <= 860)
        document.getElementById("sidebar").classList.add("hidden-mobile");
    } catch (e) { toast(e.message, "error"); }
    finally { btn.disabled = false; btn.textContent = "Message"; }
  });

  wrap.appendChild(av);
  wrap.appendChild(body);
  wrap.appendChild(btn);
  return wrap;
}

function renderChatsList(container) {
  if (!state.chats.length) {
    const e = document.createElement("div");
    e.className = "empty-state";
    e.textContent = "No chats yet. Tap + or search a NEXORA ID.";
    container.appendChild(e);
    return;
  }

  state.chats.forEach((chat) => {
    const item = document.createElement("div");
    item.className = "list-item" + (chat.id === state.activeChatId ? " active" : "");
    item.dataset.chatId = chat.id;

    // Аватар
    const av = chatAvatarNode(chat);

    const body = document.createElement("div");
    body.className = "list-item-body";

    const title = document.createElement("div");
    title.className = "list-item-title";
    const titleName = document.createElement("span");
    titleName.textContent = chat.display_title || "Chat";
    if (chat.type === "channel") {
      const b = document.createElement("span");
      b.style.fontSize = "11px";
      b.style.color = "var(--text-3)";
      b.textContent = " CH";
      titleName.appendChild(b);
    }
    const titleTime = document.createElement("span");
    titleTime.className = "list-item-time";
    if (chat.last_message) titleTime.textContent = formatTime(chat.last_message.created_at);
    title.appendChild(titleName);
    title.appendChild(titleTime);

    const sub = document.createElement("div");
    sub.className = "list-item-sub";
    if (chat.last_message) {
      const kindIcon = chat.last_message.kind === "image" ? "🖼️ "
        : chat.last_message.kind === "video" ? "🎬 "
        : chat.last_message.kind === "file" ? "📎 "
        : chat.last_message.kind === "sticker" ? "🎨 "
        : "";
      sub.textContent = (chat.last_message.is_own ? "You: " : "") +
        kindIcon + (chat.last_message.content || "").slice(0, 60);
    } else {
      sub.textContent = "No messages yet";
    }

    body.appendChild(title);
    body.appendChild(sub);
    item.appendChild(av);
    item.appendChild(body);

    item.addEventListener("click", async () => {
      await openChat(chat.id);
      if (window.innerWidth <= 860)
        document.getElementById("sidebar").classList.add("hidden-mobile");
    });

    container.appendChild(item);
  });
}

function chatAvatarNode(chat) {
  const el = document.createElement("div");
  el.className = "chat-avatar";
  if (chat.type === "channel") el.classList.add("channel");

  if (chat.avatar_url) {
    const img = document.createElement("img");
    img.src = chat.avatar_url;
    img.alt = "";
    el.appendChild(img);
    return el;
  }
  if (chat.type === "direct" && chat.other_user) {
    if (chat.other_user.avatar_url) {
      const img = document.createElement("img");
      img.src = chat.other_user.avatar_url;
      el.appendChild(img);
      return el;
    }
    if (chat.other_user.system_avatar) {
      const img = document.createElement("img");
      img.src = chat.other_user.system_avatar;
      el.appendChild(img);
      return el;
    }
    el.textContent = initials(chat.other_user.username);
    return el;
  }
  el.textContent = initials(chat.display_title);
  return el;
}

function renderContactsList(container) {
  if (!state.contacts.length) {
    const e = document.createElement("div");
    e.className = "empty-state";
    e.textContent = "No contacts. Search a NEXORA ID to add someone.";
    container.appendChild(e);
    return;
  }

  state.contacts.forEach((c) => {
    const item = document.createElement("div");
    item.className = "list-item";

    const wrap = document.createElement("div");
    wrap.className = "avatar-wrap";
    const av = avatarNode(c, "md");
    wrap.appendChild(av);
    const dot = document.createElement("span");
    dot.className = "online-dot" + (c.is_online && c.show_online ? " online" : "");
    wrap.appendChild(dot);

    const body = document.createElement("div");
    body.className = "list-item-body";
    const title = document.createElement("div");
    title.className = "list-item-title";
    const nameSpan = document.createElement("span");
    nameSpan.textContent = c.username;
    title.appendChild(nameSpan);
    const sub = document.createElement("div");
    sub.className = "list-item-sub";
    sub.textContent = c.nexora_id;
    body.appendChild(title);
    body.appendChild(sub);

    item.appendChild(wrap);
    item.appendChild(body);

    const msgBtn = document.createElement("button");
    msgBtn.className = "btn btn-ghost";
    msgBtn.textContent = "Open";
    msgBtn.style.padding = "4px 10px";
    msgBtn.style.fontSize = "12px";
    msgBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const chatId = await openDirectChat(c.user_id);
      await refreshChats();
      await openChat(chatId);
    });

    item.appendChild(msgBtn);
    container.appendChild(item);
  });
}

async function refreshChats() {
  try { state.chats = await listChats(); renderSidebarBody(); }
  catch (e) { toast(e.message, "error"); }
}

async function refreshContacts() {
  try { state.contacts = await listContacts(); renderSidebarBody(); }
  catch (e) { toast(e.message, "error"); }
}

// ============================================================
// Открытие чата
// ============================================================
async function openChat(chatId) {
  closePanel();
  state.activeChatId = chatId;
  const chat = state.chats.find((c) => c.id === chatId) || null;
  state.activeChat = chat;
  state.activeChatPeer = chat && chat.type === "direct" ? chat.other_user : null;

  document.getElementById("welcome").classList.add("hidden");
  const chatView = document.getElementById("chat-view");
  chatView.classList.remove("hidden");

  // Загрузим участников
  try {
    const members = await listChatMembers(chatId);
    state.membersByChat[chatId] = members;
  } catch (_) { state.membersByChat[chatId] = []; }

  renderChatHeader(chat);

  const messagesEl = document.getElementById("messages");
  messagesEl.innerHTML = "";

  let msgs = [];
  try { msgs = await loadMessages(chatId); }
  catch (e) { toast("Failed to load messages", "error"); }

  // Загрузим реакции
  try { state.reactionsByMessage = await loadReactionsForChat(chatId); }
  catch (_) { state.reactionsByMessage = {}; }

  const membersById = {};
  (state.membersByChat[chatId] || []).forEach(m => membersById[m.user_id] = m);

  let prev = null;
  for (const m of msgs) {
    const sender = membersById[m.sender_id];
    renderMessage(m, state.user.id, messagesEl, prev, {
      showSender: chat && chat.type !== "direct" && m.sender_id !== state.user.id,
      senderName: sender ? sender.username : "User",
    });
    prev = m;
  }
  applyReactionsToDom();
  scrollToBottom();

  unsubscribeFromChat();
  subscribeToChat(chatId, {
    onInsert: (m) => onRealtimeInsert(m, chat),
    onUpdate: (m) => onRealtimeUpdate(m),
    onDelete: (m) => onRealtimeDelete(m),
  });

  if (state.reactionsSubChannel) {
    supabase.removeChannel(state.reactionsSubChannel);
  }
  state.reactionsSubChannel = subscribeToReactions(chatId, () => reloadReactions(chatId));

  // Композер: для канала — только owner/admin
  updateComposerForChannel(chat);

  refreshChats();
}

function updateComposerForChannel(chat) {
  const composer = document.querySelector(".composer");
  if (!composer) return;
  const blocked = chat && chat.type === "channel" &&
    chat.my_role !== "owner" && chat.my_role !== "admin";
  const input = document.getElementById("composer-input");
  const btn = document.getElementById("send-btn");
  const attachBtn = document.getElementById("attach-btn");
  const emojiBtn = document.getElementById("emoji-btn");
  const stickerBtn = document.getElementById("sticker-btn");
  if (blocked) {
    input.disabled = true;
    input.placeholder = "Only admins can post in this channel";
    btn.disabled = true;
    if (attachBtn) attachBtn.disabled = true;
    if (emojiBtn) emojiBtn.disabled = true;
    if (stickerBtn) stickerBtn.disabled = true;
  } else {
    input.disabled = false;
    input.placeholder = "Write a message…  (Enter to send, Shift+Enter new line)";
    btn.disabled = false;
    if (attachBtn) attachBtn.disabled = false;
    if (emojiBtn) emojiBtn.disabled = false;
    if (stickerBtn) stickerBtn.disabled = false;
  }
}

function renderChatHeader(chat) {
  const header = document.getElementById("chat-header");
  header.innerHTML = "";

  const mobileBtn = document.createElement("button");
  mobileBtn.className = "mobile-menu-btn";
  mobileBtn.textContent = "☰";
  mobileBtn.addEventListener("click", () => {
    document.getElementById("sidebar").classList.remove("hidden-mobile");
  });
  header.appendChild(mobileBtn);

  if (!chat) {
    header.appendChild(document.createElement("div"));
    return;
  }

  const av = chatAvatarNode(chat);
  const body = document.createElement("div");
  body.className = "chat-header-body";

  const name = document.createElement("div");
  name.className = "chat-header-name";
  name.textContent = chat.display_title;
  if (chat.type === "direct" && chat.other_user) {
    const dot = document.createElement("span");
    const online = chat.other_user.is_online && chat.other_user.show_online !== false;
    dot.className = "online-dot" + (online ? " online" : "");
    name.appendChild(dot);
  }
  body.appendChild(name);

  const sub = document.createElement("div");
  sub.className = "chat-header-id";
  if (chat.type === "direct" && chat.other_user) {
    sub.textContent = chat.other_user.nexora_id;
  } else if (chat.type === "channel") {
    sub.textContent = "Channel";
  } else {
    sub.textContent = (chat.members ? chat.members.length : 0) + " members";
  }
  body.appendChild(sub);

  body.addEventListener("click", () => openChatInfoPanel(chat));

  header.appendChild(av);
  header.appendChild(body);
}

// ============================================================
// Realtime
// ============================================================
function onRealtimeInsert(m, chat) {
  if (m.chat_id !== state.activeChatId) { refreshChats(); return; }
  if (m.sender_id === state.user.id) return;

  const container = document.getElementById("messages");
  const rows = container.querySelectorAll(".msg-row");
  const lastRow = rows[rows.length - 1];
  let prevMsg = null;
  if (lastRow) {
    const cached = getCachedMessage(lastRow.dataset.messageId);
    prevMsg = cached || { created_at: lastRow.dataset.createdAt };
  }
  const members = state.membersByChat[state.activeChatId] || [];
  const sender = members.find(x => x.user_id === m.sender_id);
  renderMessage(m, state.user.id, container, prevMsg, {
    showSender: chat && chat.type !== "direct",
    senderName: sender ? sender.username : "User",
  });
  scrollToBottom();
  refreshChats();
}

function onRealtimeUpdate(m) {
  if (m.chat_id !== state.activeChatId) return;
  const row = document.querySelector(`.msg-row[data-message-id="${m.id}"]`);
  if (!row) return;
  const contentDiv = row.querySelector(".msg-content");
  if (contentDiv) contentDiv.innerHTML = formatMessage(m.content);
  const meta = row.querySelector(".msg-meta");
  if (meta) {
    meta.innerHTML = "";
    if (m.edited_at) {
      const ed = document.createElement("span");
      ed.className = "msg-edited";
      ed.textContent = "(edited)";
      meta.appendChild(ed);
    }
    const time = document.createElement("span");
    time.textContent = formatTime(m.created_at);
    meta.appendChild(time);
  }
}

function onRealtimeDelete(m) {
  const row = document.querySelector(`.msg-row[data-message-id="${m.id}"]`);
  if (row) row.remove();
}

function onProfileUpdate(p) {
  if (state.activeChatPeer && state.activeChatPeer.id === p.id) {
    state.activeChatPeer.is_online = p.is_online;
    state.activeChatPeer.show_online = p.show_online;
    state.activeChatPeer.username = p.username;
    state.activeChatPeer.avatar_url = p.avatar_url;
    state.activeChatPeer.system_avatar = p.system_avatar;
    if (state.activeChat) renderChatHeader(state.activeChat);
  }
  const idx = state.contacts.findIndex((c) => c.user_id === p.id);
  if (idx >= 0) {
    state.contacts[idx].is_online = p.is_online;
    state.contacts[idx].username = p.username;
    state.contacts[idx].avatar_url = p.avatar_url;
    state.contacts[idx].system_avatar = p.system_avatar;
    renderSidebarBody();
  }
  state.chats.forEach((c) => {
    if (c.other_user && c.other_user.id === p.id) {
      c.other_user.is_online = p.is_online;
      c.other_user.username = p.username;
      c.other_user.avatar_url = p.avatar_url;
      c.other_user.system_avatar = p.system_avatar;
      c.other_user.show_online = p.show_online;
    }
  });
  renderSidebarBody();
}

async function reloadReactions(chatId) {
  try {
    state.reactionsByMessage = await loadReactionsForChat(chatId);
    applyReactionsToDom();
  } catch (_) {}
}

function applyReactionsToDom() {
  document.querySelectorAll("[data-reactions-for]").forEach(box => {
    const msgId = box.dataset.reactionsFor;
    const data = state.reactionsByMessage[msgId] || {};
    box.innerHTML = "";
    Object.keys(data).forEach(emoji => {
      const users = data[emoji];
      const chip = document.createElement("div");
      chip.className = "reaction-chip" +
        (users.includes(state.user.id) ? " mine" : "");
      chip.textContent = emoji + " " + users.length;
      chip.addEventListener("click", async () => {
        try {
          await toggleReaction(msgId, emoji, state.user.id);
          await reloadReactions(state.activeChatId);
        } catch (e) { toast(e.message, "error"); }
      });
      box.appendChild(chip);
    });
  });
}

// ============================================================
// Отправка
// ============================================================
async function onSendMessage() {
  const input = document.getElementById("composer-input");
  const content = input.value.trim();
  if (!state.activeChatId) return;

  // Если есть pending attachment — шлём его
  if (state.pendingAttachment) {
    input.value = "";
    autoResize(input);
    const att = state.pendingAttachment;
    state.pendingAttachment = null;
    removeAttachmentPreview();

    const optimistic = {
      id: "temp-" + Date.now(),
      chat_id: state.activeChatId,
      sender_id: state.user.id,
      content,
      kind: att.kind,
      attachment_url: att.url,
      file_name: att.name,
      file_size: att.size,
      edited_at: null,
      created_at: new Date().toISOString(),
    };
    const container = document.getElementById("messages");
    const prevMsg = getLastPrevMsg();
    renderMessage(optimistic, state.user.id, container, prevMsg);
    scrollToBottom();

    try {
      const saved = await sendAttachmentMessage(state.activeChatId, att, content);
      const tmp = document.querySelector(`.msg-row[data-message-id="${optimistic.id}"]`);
      if (tmp) { tmp.dataset.messageId = saved.id; }
      refreshChats();
    } catch (e) {
      toast(e.message, "error");
      const tmp = document.querySelector(`.msg-row[data-message-id="${optimistic.id}"]`);
      if (tmp) tmp.remove();
    }
    return;
  }

  if (!content) return;
  input.value = "";
  autoResize(input);

  const optimistic = {
    id: "temp-" + Date.now(),
    chat_id: state.activeChatId,
    sender_id: state.user.id,
    content,
    kind: "text",
    edited_at: null,
    created_at: new Date().toISOString(),
  };
  const container = document.getElementById("messages");
  const prevMsg = getLastPrevMsg();
  renderMessage(optimistic, state.user.id, container, prevMsg);
  scrollToBottom();

  try {
    const saved = await sendMessage(state.activeChatId, content);
    const tmp = document.querySelector(`.msg-row[data-message-id="${optimistic.id}"]`);
    if (tmp) { tmp.dataset.messageId = saved.id; tmp.dataset.createdAt = saved.created_at; }
    refreshChats();
  } catch (e) {
    toast(e.message, "error");
    const tmp = document.querySelector(`.msg-row[data-message-id="${optimistic.id}"]`);
    if (tmp) tmp.remove();
  }
}

function getLastPrevMsg() {
  const rows = document.querySelectorAll(".msg-row");
  const last = rows[rows.length - 1];
  if (!last) return null;
  const cached = getCachedMessage(last.dataset.messageId);
  return cached || { created_at: last.dataset.createdAt };
}

function scrollToBottom() {
  const el = document.getElementById("messages");
  requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
}

// ============================================================
// Вложения
// ============================================================
async function onAttachPick(e) {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file || !state.activeChatId) return;

  if (file.size > 50 * 1024 * 1024) {
    toast("File too large (max 50 MB)", "error");
    return;
  }

  toast("Uploading " + file.name + "...", "info");
  try {
    const att = await uploadAttachment(file, state.activeChatId);
    state.pendingAttachment = att;
    showAttachmentPreview(att, file);
  } catch (err) {
    toast(err.message, "error");
  }
}

function showAttachmentPreview(att, file) {
  removeAttachmentPreview();
  const composer = document.querySelector(".composer");
  const box = document.createElement("div");
  box.id = "attachment-preview";
  box.style.cssText = `
    display:flex; gap:10px; align-items:center;
    padding:10px 12px; margin-bottom:10px;
    background:rgba(124,92,255,0.1); border:1px solid rgba(124,92,255,0.3);
    border-radius:12px; font-size:13px;
  `;
  let thumb;
  if (att.kind === "image") {
    thumb = document.createElement("img");
    thumb.src = att.url;
    thumb.style.cssText = "width:52px;height:52px;object-fit:cover;border-radius:8px;";
  } else if (att.kind === "video") {
    thumb = document.createElement("div");
    thumb.textContent = "🎬";
    thumb.style.cssText = "font-size:32px;";
  } else {
    thumb = document.createElement("div");
    thumb.textContent = "📄";
    thumb.style.cssText = "font-size:32px;";
  }
  const body = document.createElement("div");
  body.style.flex = "1";
  body.innerHTML = `<div style="font-weight:600">${escapeHtml(att.name)}</div>
    <div style="color:var(--text-3);font-size:12px">${humanFileSize(att.size)}</div>`;
  const cancel = document.createElement("button");
  cancel.className = "btn-icon";
  cancel.textContent = "✕";
  cancel.addEventListener("click", () => {
    state.pendingAttachment = null;
    removeAttachmentPreview();
  });
  box.appendChild(thumb);
  box.appendChild(body);
  box.appendChild(cancel);
  composer.insertBefore(box, composer.firstChild);
}

function removeAttachmentPreview() {
  const b = document.getElementById("attachment-preview");
  if (b) b.remove();
}

// ============================================================
// Emoji / sticker picker
// ============================================================
function toggleEmojiPicker() {
  const existing = document.getElementById("picker");
  if (existing && existing.dataset.mode === "emoji") { existing.remove(); return; }
  if (existing) existing.remove();
  openPicker("emoji");
}

function toggleStickerPicker() {
  const existing = document.getElementById("picker");
  if (existing && existing.dataset.mode === "stickers") { existing.remove(); return; }
  if (existing) existing.remove();
  openPicker("stickers");
}

function openPicker(mode) {
  const composer = document.querySelector(".composer");
  const picker = document.createElement("div");
  picker.className = "picker";
  picker.id = "picker";
  picker.dataset.mode = mode;

  const tabs = document.createElement("div");
  tabs.className = "picker-tabs";
  picker.appendChild(tabs);

  const body = document.createElement("div");
  body.className = "picker-body" + (mode === "stickers" ? " stickers" : "");
  picker.appendChild(body);

  composer.appendChild(picker);

  if (mode === "emoji") {
    const cats = Object.keys(EMOJI_CATEGORIES);
    let activeCat = cats[0];
    cats.forEach(cat => {
      const t = document.createElement("button");
      t.className = "picker-tab" + (cat === activeCat ? " active" : "");
      t.textContent = cat;
      t.addEventListener("click", () => {
        activeCat = cat;
        tabs.querySelectorAll(".picker-tab").forEach(x => x.classList.remove("active"));
        t.classList.add("active");
        renderEmojiCat(body, cat);
      });
      tabs.appendChild(t);
    });
    renderEmojiCat(body, activeCat);
  } else {
    // Стикеры: системные + кастомные + кнопка загрузки
    const sysTab = document.createElement("button");
    sysTab.className = "picker-tab active";
    sysTab.textContent = "System";
    const customTab = document.createElement("button");
    customTab.className = "picker-tab";
    customTab.textContent = "Custom";
    const uploadTab = document.createElement("button");
    uploadTab.className = "picker-tab";
    uploadTab.textContent = "+ Upload";
    tabs.appendChild(sysTab);
    tabs.appendChild(customTab);
    tabs.appendChild(uploadTab);

    const renderSystem = () => {
      body.innerHTML = "";
      listSystemStickers().forEach(s => {
        body.appendChild(stickerTile(s, () => sendSticker(s.id, s.url)));
      });
    };
    const renderCustom = async () => {
      body.innerHTML = '<div class="empty-state"><span class="spinner"></span></div>';
      try {
        const list = await listCustomStickers();
        body.innerHTML = "";
        if (!list.length) {
          body.innerHTML = '<div class="empty-state">No custom stickers yet. Upload one!</div>';
          return;
        }
        list.forEach(s => {
          const tile = stickerTile({ id: s.id, url: s.url, name: s.name }, () => sendSticker(s.id, s.url));
          if (s.uploaded_by === state.user.id) {
            const del = document.createElement("button");
            del.textContent = "✕";
            del.style.cssText = `
              position:absolute;top:2px;right:2px;width:20px;height:20px;
              border-radius:50%;background:rgba(255,90,110,0.85);color:#fff;
              font-size:11px;line-height:1;display:flex;align-items:center;
              justify-content:center;`;
            del.addEventListener("click", async (e) => {
              e.stopPropagation();
              if (!confirm("Delete sticker?")) return;
              try {
                await deleteSticker(s.id);
                renderCustom();
              } catch (err) { toast(err.message, "error"); }
            });
            tile.style.position = "relative";
            tile.appendChild(del);
          }
          body.appendChild(tile);
        });
      } catch (e) {
        body.innerHTML = `<div class="empty-state">Error: ${escapeHtml(e.message)}</div>`;
      }
    };
    const renderUpload = () => {
      body.innerHTML = "";
      body.className = "picker-body";
      const wrap = document.createElement("div");
      wrap.style.cssText = "grid-column:1/-1;padding:20px;text-align:center;";
      wrap.innerHTML = `
        <p style="color:var(--text-2);font-size:13px;margin-bottom:12px">
          Upload a PNG / GIF / WEBP up to 2 MB
        </p>
      `;
      const inp = document.createElement("input");
      inp.type = "file";
      inp.accept = "image/*";
      inp.style.display = "none";
      inp.addEventListener("change", async (e) => {
        const f = e.target.files[0];
        if (!f) return;
        try {
          toast("Uploading...", "info");
          await uploadSticker(f, f.name.replace(/\.[^.]+$/, ""));
          toast("Sticker uploaded", "success");
          renderCustom();
        } catch (err) { toast(err.message, "error"); }
      });
      const btn = document.createElement("button");
      btn.className = "btn btn-primary";
      btn.textContent = "Choose file";
      btn.addEventListener("click", () => inp.click());
      wrap.appendChild(btn);
      wrap.appendChild(inp);
      body.appendChild(wrap);
    };

    sysTab.addEventListener("click", () => {
      tabs.querySelectorAll(".picker-tab").forEach(x => x.classList.remove("active"));
      sysTab.classList.add("active");
      body.className = "picker-body stickers";
      renderSystem();
    });
    customTab.addEventListener("click", () => {
      tabs.querySelectorAll(".picker-tab").forEach(x => x.classList.remove("active"));
      customTab.classList.add("active");
      body.className = "picker-body stickers";
      renderCustom();
    });
    uploadTab.addEventListener("click", () => {
      tabs.querySelectorAll(".picker-tab").forEach(x => x.classList.remove("active"));
      uploadTab.classList.add("active");
      body.className = "picker-body";
      renderUpload();
    });

    renderSystem();
  }
}

function renderEmojiCat(body, cat) {
  body.innerHTML = "";
  (EMOJI_CATEGORIES[cat] || []).forEach(e => {
    const b = document.createElement("button");
    b.className = "picker-emoji";
    b.textContent = e;
    b.addEventListener("click", () => {
      const input = document.getElementById("composer-input");
      input.value += e;
      input.focus();
      autoResize(input);
    });
    body.appendChild(b);
  });
}

function stickerTile(s, onClick) {
  const t = document.createElement("div");
  t.className = "picker-sticker";
  const img = document.createElement("img");
  img.src = s.url;
  img.alt = s.name || "sticker";
  t.appendChild(img);
  t.addEventListener("click", onClick);
  return t;
}

async function sendSticker(stickerId, url) {
  const picker = document.getElementById("picker");
  if (picker) picker.remove();
  if (!state.activeChatId) return;

  const optimistic = {
    id: "temp-" + Date.now(),
    chat_id: state.activeChatId,
    sender_id: state.user.id,
    content: "",
    kind: "sticker",
    sticker_id: stickerId,
    attachment_url: url, // для кастомных — пригодится в рендере
    edited_at: null,
    created_at: new Date().toISOString(),
  };
  const container = document.getElementById("messages");
  const prevMsg = getLastPrevMsg();
  renderMessage(optimistic, state.user.id, container, prevMsg);
  scrollToBottom();

  try {
    const saved = await sendStickerMessage(state.activeChatId, stickerId, url);
    // Сохраним URL в attachment_url, чтобы кастомный стикер отрисовался везде
    if (!stickerId.startsWith("sys-") && url) {
      await supabase.from("messages").update({ attachment_url: url }).eq("id", saved.id);
    }
    const tmp = document.querySelector(`.msg-row[data-message-id="${optimistic.id}"]`);
    if (tmp) tmp.dataset.messageId = saved.id;
    refreshChats();
  } catch (e) {
    toast(e.message, "error");
    const tmp = document.querySelector(`.msg-row[data-message-id="${optimistic.id}"]`);
    if (tmp) tmp.remove();
  }
}

// ============================================================
// Панели
// ============================================================
function closePanel() { document.querySelectorAll(".panel").forEach(p => p.remove()); }

function renderWelcome() {
  const w = document.getElementById("welcome");
  w.innerHTML = "";
  const logo = document.createElement("div");
  logo.className = "welcome-logo";
  logo.textContent = "NEXORA";
  const tag = document.createElement("div");
  tag.className = "welcome-tagline";
  tag.textContent = "Connect without limits.";
  const hint = document.createElement("div");
  hint.style.marginTop = "24px";
  hint.style.fontSize = "13px";
  hint.style.color = "var(--text-3)";
  hint.textContent = "Search a NEXORA ID, create a group or pick a chat.";
  w.appendChild(logo); w.appendChild(tag); w.appendChild(hint);
}

// ============================================================
// New chat dialog (Group / Channel)
// ============================================================
function openNewChatDialog() {
  closePanel();
  const panel = document.createElement("div");
  panel.className = "panel";
  panel.innerHTML = `
    <div class="panel-header">
      <button class="btn-icon" data-close-panel>←</button>
      <h2>New</h2>
    </div>
    <div class="panel-body">
      <div class="settings-section">
        <h3>✎ Create</h3>
        <div style="display:flex;gap:8px;margin-bottom:12px">
          <button class="btn btn-primary" id="type-group">Group</button>
          <button class="btn btn-ghost" id="type-channel">Channel</button>
        </div>
        <div class="form-group">
          <label class="form-label">Title</label>
          <input id="gc-title" maxlength="80" placeholder="Team Rocket">
        </div>
        <div class="form-group" style="margin-top:10px">
          <label class="form-label">Description (optional)</label>
          <input id="gc-desc" maxlength="200" placeholder="Short description">
        </div>
        <div style="margin-top:16px">
          <label class="form-label">Add members from contacts</label>
          <div id="gc-contacts" style="margin-top:8px;max-height:280px;overflow-y:auto"></div>
        </div>
        <div style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end">
          <button class="btn btn-ghost" id="gc-cancel">Cancel</button>
          <button class="btn btn-primary" id="gc-create">Create</button>
        </div>
      </div>
    </div>
  `;
  document.getElementById("main").appendChild(panel);
  panel.querySelector("[data-close-panel]").addEventListener("click", closePanel);
  panel.querySelector("#gc-cancel").addEventListener("click", closePanel);

  let type = "group";
  const btnGroup = panel.querySelector("#type-group");
  const btnChannel = panel.querySelector("#type-channel");
  btnGroup.addEventListener("click", () => {
    type = "group";
    btnGroup.className = "btn btn-primary";
    btnChannel.className = "btn btn-ghost";
  });
  btnChannel.addEventListener("click", () => {
    type = "channel";
    btnGroup.className = "btn btn-ghost";
    btnChannel.className = "btn btn-primary";
  });

  // Список контактов с чекбоксами
  const contactsBox = panel.querySelector("#gc-contacts");
  if (!state.contacts.length) {
    contactsBox.innerHTML = '<div class="empty-state">No contacts yet. Add some via search.</div>';
  } else {
    state.contacts.forEach(c => {
      const row = document.createElement("label");
      row.style.cssText = "display:flex;align-items:center;gap:10px;padding:8px 4px;cursor:pointer;border-bottom:1px solid var(--border)";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.value = c.user_id;
      cb.style.width = "auto";
      const av = avatarNode(c, "sm");
      const name = document.createElement("div");
      name.style.flex = "1";
      name.innerHTML = `<div style="font-weight:600">${escapeHtml(c.username)}</div>
        <div style="font-size:11px;color:var(--text-3);font-family:var(--font-mono)">${escapeHtml(c.nexora_id)}</div>`;
      row.appendChild(cb);
      row.appendChild(av);
      row.appendChild(name);
      contactsBox.appendChild(row);
    });
  }

  panel.querySelector("#gc-create").addEventListener("click", async () => {
    const title = panel.querySelector("#gc-title").value.trim();
    const desc = panel.querySelector("#gc-desc").value.trim() || null;
    if (!title) { toast("Title required", "error"); return; }
    const ids = Array.from(contactsBox.querySelectorAll("input[type=checkbox]:checked"))
      .map(cb => cb.value);
    try {
      const chatId = await createGroupChat(title, ids, type, desc);
      toast(`${type === "channel" ? "Channel" : "Group"} created`, "success");
      await refreshChats();
      await openChat(chatId);
      closePanel();
    } catch (e) { toast(e.message, "error"); }
  });
}

// ============================================================
// Chat info panel
// ============================================================
async function openChatInfoPanel(chat) {
  closePanel();
  const panel = document.createElement("div");
  panel.className = "panel";
  panel.innerHTML = `
    <div class="panel-header">
      <button class="btn-icon" data-close-panel>←</button>
      <h2>${chat.type === "channel" ? "Channel info" : chat.type === "group" ? "Group info" : "Chat info"}</h2>
    </div>
    <div class="panel-body" id="chat-info-body"></div>
  `;
  document.getElementById("main").appendChild(panel);
  panel.querySelector("[data-close-panel]").addEventListener("click", closePanel);
  const body = panel.querySelector("#chat-info-body");

  // Hero
  const hero = document.createElement("div");
  hero.className = "profile-hero";

  const avWrap = document.createElement("div");
  avWrap.style.position = "relative";
  const av = chatAvatarNode(chat);
  av.style.width = "96px";
  av.style.height = "96px";
  av.style.fontSize = "38px";
  av.style.borderRadius = "24px";
  avWrap.appendChild(av);

  if (chat.type !== "direct" && (chat.my_role === "owner" || chat.my_role === "admin")) {
    const fileInp = document.createElement("input");
    fileInp.type = "file";
    fileInp.accept = "image/*";
    fileInp.style.display = "none";
    fileInp.addEventListener("change", async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        toast("Uploading...", "info");
        await uploadChatAvatar(chat.id, f);
        toast("Avatar updated", "success");
        await refreshChats();
        closePanel(); openChatInfoPanel({ ...chat, avatar_url: "loading" });
      } catch (err) { toast(err.message, "error"); }
    });
    avWrap.appendChild(fileInp);
    const changeBtn = document.createElement("button");
    changeBtn.className = "btn btn-ghost";
    changeBtn.style.cssText = "position:absolute;bottom:0;right:0;padding:6px;border-radius:50%;width:36px;height:36px;";
    changeBtn.textContent = "📷";
    changeBtn.addEventListener("click", () => fileInp.click());
    avWrap.appendChild(changeBtn);
  }

  const name = document.createElement("div");
  name.className = "profile-hero-name";
  name.textContent = chat.display_title;
  hero.appendChild(avWrap);
  hero.appendChild(name);

  if (chat.type === "direct" && chat.other_user) {
    const idEl = document.createElement("div");
    idEl.className = "profile-hero-id";
    idEl.textContent = chat.other_user.nexora_id;
    idEl.addEventListener("click", () => {
      navigator.clipboard.writeText(chat.other_user.nexora_id);
      toast("Copied", "success");
    });
    hero.appendChild(idEl);
  } else {
    const typeBadge = document.createElement("span");
    typeBadge.className = "badge " + (chat.type === "channel" ? "accent" : "muted");
    typeBadge.textContent = chat.type === "channel" ? "Channel" : "Group";
    hero.appendChild(typeBadge);
  }
  body.appendChild(hero);

  // Description
  if (chat.type !== "direct") {
    const descSection = document.createElement("div");
    descSection.className = "settings-section";
    descSection.innerHTML = `<h3>ℹ Description</h3>`;
    if (chat.my_role === "owner" || chat.my_role === "admin") {
      const inp = document.createElement("textarea");
      inp.value = chat.description || "";
      inp.placeholder = "No description";
      inp.maxLength = 200;
      const save = document.createElement("button");
      save.className = "btn btn-primary";
      save.textContent = "Save";
      save.style.marginTop = "10px";
      save.addEventListener("click", async () => {
        try {
          await updateChat(chat.id, { description: inp.value.trim() || null });
          toast("Updated", "success");
          await refreshChats();
        } catch (e) { toast(e.message, "error"); }
      });
      descSection.appendChild(inp);
      descSection.appendChild(save);
    } else {
      descSection.innerHTML += `<p style="color:var(--text-2);font-size:13px">${escapeHtml(chat.description || "No description")}</p>`;
    }
    body.appendChild(descSection);
  }

  // Members
  if (chat.type !== "direct") {
    const membersSection = document.createElement("div");
    membersSection.className = "settings-section";
    membersSection.innerHTML = `<h3>👥 Members</h3>`;
    const list = await listChatMembers(chat.id);
    list.forEach(m => {
      const row = document.createElement("div");
      row.className = "settings-row";
      const info = document.createElement("div");
      info.className = "settings-row-info";
      info.style.display = "flex";
      info.style.alignItems = "center";
      info.style.gap = "10px";
      const avv = avatarNode(m, "sm");
      const text = document.createElement("div");
      text.innerHTML = `<div style="font-weight:600">${escapeHtml(m.username)}
        ${m.role !== "member" ? '<span class="badge accent" style="margin-left:6px">' + m.role + '</span>' : ''}</div>
        <div style="font-size:11px;color:var(--text-3);font-family:var(--font-mono)">${escapeHtml(m.nexora_id)}</div>`;
      info.appendChild(avv); info.appendChild(text);
      row.appendChild(info);
      membersSection.appendChild(row);
    });
    if (chat.type === "group" || chat.my_role === "owner" || chat.my_role === "admin") {
      const addBtn = document.createElement("button");
      addBtn.className = "btn btn-ghost";
      addBtn.textContent = "+ Add member";
      addBtn.style.marginTop = "12px";
      addBtn.addEventListener("click", () => openAddMemberDialog(chat));
      membersSection.appendChild(addBtn);
    }
    body.appendChild(membersSection);
  }

  // Actions
  const actions = document.createElement("div");
  actions.className = "settings-section";
  if (chat.type !== "direct") {
    const leaveBtn = document.createElement("button");
    leaveBtn.className = "btn btn-danger";
    leaveBtn.textContent = "Leave " + chat.type;
    leaveBtn.addEventListener("click", async () => {
      if (!confirm("Leave this " + chat.type + "?")) return;
      const { error } = await supabase
        .from("chat_members")
        .delete()
        .eq("chat_id", chat.id)
        .eq("user_id", state.user.id);
      if (error) { toast(error.message, "error"); return; }
      toast("Left", "success");
      closePanel();
      state.activeChatId = null;
      document.getElementById("chat-view").classList.add("hidden");
      document.getElementById("welcome").classList.remove("hidden");
      await refreshChats();
    });
    actions.appendChild(leaveBtn);
  }
  body.appendChild(actions);
}

async function openAddMemberDialog(chat) {
  const list = await listChatMembers(chat.id);
  const existing = new Set(list.map(m => m.user_id));
  const candidates = state.contacts.filter(c => !existing.has(c.user_id));
  if (!candidates.length) { toast("All contacts already added", "info"); return; }

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <div class="modal-title">Add members</div>
        <button class="modal-close">×</button>
      </div>
      <div class="modal-body" id="am-body"></div>
    </div>
  `;
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.querySelector(".modal-close").addEventListener("click", close);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });

  const body = backdrop.querySelector("#am-body");
  candidates.forEach(c => {
    const row = document.createElement("div");
    row.className = "settings-row";
    const info = document.createElement("div");
    info.className = "settings-row-info";
    info.innerHTML = `<div style="font-weight:600">${escapeHtml(c.username)}</div>
      <div style="font-size:11px;color:var(--text-3);font-family:var(--font-mono)">${escapeHtml(c.nexora_id)}</div>`;
    const btn = document.createElement("button");
    btn.className = "btn btn-primary";
    btn.textContent = "Add";
    btn.addEventListener("click", async () => {
      try {
        await addChatMember(chat.id, c.user_id);
        toast("Added", "success");
        btn.disabled = true;
        btn.textContent = "✓";
      } catch (e) { toast(e.message, "error"); }
    });
    row.appendChild(info);
    row.appendChild(btn);
    body.appendChild(row);
  });
}

// ============================================================
// Profile panel (с системными аватарками)
// ============================================================
function openProfilePanel() {
  closePanel();
  const panel = document.createElement("div");
  panel.className = "panel";
  panel.innerHTML = `
    <div class="panel-header">
      <button class="btn-icon" data-close-panel>←</button>
      <h2>Profile</h2>
    </div>
    <div class="panel-body" id="profile-panel-body"></div>
  `;
  document.getElementById("main").appendChild(panel);
  panel.querySelector("[data-close-panel]").addEventListener("click", closePanel);
  const body = panel.querySelector("#profile-panel-body");

  const hero = document.createElement("div");
  hero.className = "profile-hero";
  const wrap = document.createElement("div");
  wrap.style.position = "relative";
  const av = avatarNode(state.profile, "xl");
  wrap.appendChild(av);

  const changeAv = document.createElement("input");
  changeAv.type = "file";
  changeAv.accept = "image/*";
  changeAv.style.display = "none";
  changeAv.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      toast("Uploading...", "info");
      const url = await uploadAvatar(file);
      state.profile.avatar_url = url;
      state.profile.system_avatar = null;
      renderSidebarFooter();
      openProfilePanel();
      toast("Avatar updated", "success");
    } catch (err) { toast(err.message, "error"); }
  });
  wrap.appendChild(changeAv);

  const uploadBtn = document.createElement("button");
  uploadBtn.className = "btn btn-ghost";
  uploadBtn.style.cssText = "position:absolute;bottom:0;right:0;padding:6px;border-radius:50%;width:36px;height:36px;";
  uploadBtn.textContent = "📷";
  uploadBtn.title = "Upload custom";
  uploadBtn.addEventListener("click", () => changeAv.click());
  wrap.appendChild(uploadBtn);

  const name = document.createElement("div");
  name.className = "profile-hero-name";
  name.textContent = state.profile.username;

  const idEl = document.createElement("div");
  idEl.className = "profile-hero-id";
  idEl.textContent = state.profile.nexora_id;
  idEl.title = "Click to copy";
  idEl.addEventListener("click", () => {
    navigator.clipboard.writeText(state.profile.nexora_id);
    toast("NEXORA ID copied", "success");
  });

  hero.appendChild(wrap);
  hero.appendChild(name);
  hero.appendChild(idEl);
  body.appendChild(hero);

  // Системные аватарки
  const sysSection = document.createElement("div");
  sysSection.className = "settings-section";
  sysSection.innerHTML = `<h3>🎨 System avatars</h3>`;
  const grid = document.createElement("div");
  grid.className = "avatar-grid";
  buildSystemAvatars(state.profile.username).forEach(a => {
    const b = document.createElement("button");
    const img = document.createElement("img");
    img.src = a.url;
    img.alt = "";
    b.appendChild(img);
    if (state.profile.system_avatar === a.url) b.classList.add("selected");
    b.addEventListener("click", async () => {
      try {
        await setSystemAvatar(a.url);
        state.profile.system_avatar = a.url;
        state.profile.avatar_url = null;
        renderSidebarFooter();
        toast("Avatar updated", "success");
        openProfilePanel();
      } catch (e) { toast(e.message, "error"); }
    });
    grid.appendChild(b);
  });
  sysSection.appendChild(grid);
  body.appendChild(sysSection);

  // Username
  const uSection = document.createElement("div");
  uSection.className = "settings-section";
  uSection.innerHTML = `<h3>✎ Username</h3>`;
  const uInput = document.createElement("input");
  uInput.value = state.profile.username;
  uInput.maxLength = 24;
  const uSave = document.createElement("button");
  uSave.className = "btn btn-primary";
  uSave.textContent = "Save";
  uSave.style.marginTop = "10px";
  uSave.addEventListener("click", async () => {
    try {
      const updated = await updateProfile({ username: uInput.value });
      state.profile.username = updated.username;
      renderSidebarFooter();
      toast("Username updated", "success");
      openProfilePanel();
    } catch (e) { toast(e.message, "error"); }
  });
  uSection.appendChild(uInput);
  uSection.appendChild(uSave);
  body.appendChild(uSection);

  // About
  const aSection = document.createElement("div");
  aSection.className = "settings-section";
  aSection.innerHTML = `<h3>ℹ About</h3>`;
  const aInput = document.createElement("textarea");
  aInput.value = state.profile.about || "";
  aInput.maxLength = 300;
  aInput.rows = 3;
  aInput.placeholder = "Tell others about you";
  const aSave = document.createElement("button");
  aSave.className = "btn btn-primary";
  aSave.textContent = "Save";
  aSave.style.marginTop = "10px";
  aSave.addEventListener("click", async () => {
    try {
      const updated = await updateProfile({ about: aInput.value });
      state.profile.about = updated.about;
      toast("About updated", "success");
    } catch (e) { toast(e.message, "error"); }
  });
  aSection.appendChild(aInput);
  aSection.appendChild(aSave);
  body.appendChild(aSection);

  const lSection = document.createElement("div");
  lSection.className = "settings-section";
  const lo = document.createElement("button");
  lo.className = "btn btn-danger";
  lo.textContent = "Log out";
  lo.addEventListener("click", () => logout());
  lSection.appendChild(lo);
  body.appendChild(lSection);
}

// ============================================================
// Settings panel
// ============================================================
function openSettingsPanel() {
  closePanel();
  const panel = document.createElement("div");
  panel.className = "panel";
  panel.innerHTML = `
    <div class="panel-header">
      <button class="btn-icon" data-close-panel>←</button>
      <h2>Settings</h2>
    </div>
    <div class="panel-body" id="settings-panel-body"></div>
  `;
  document.getElementById("main").appendChild(panel);
  panel.querySelector("[data-close-panel]").addEventListener("click", closePanel);
  const body = panel.querySelector("#settings-panel-body");
  body.appendChild(accountSection());
  body.appendChild(securitySection());
  body.appendChild(appearanceSection());
  body.appendChild(privacySection());
}

function accountSection() {
  const s = document.createElement("div");
  s.className = "settings-section";
  s.innerHTML = `<h3>👤 Account</h3>`;

  const rowId = document.createElement("div");
  rowId.className = "settings-row";
  rowId.innerHTML = `
    <div class="settings-row-info">
      <div class="settings-row-label">NEXORA ID</div>
      <div class="settings-row-desc">${escapeHtml(state.profile.nexora_id)}</div>
    </div>
  `;
  const copyBtn = document.createElement("button");
  copyBtn.className = "btn btn-ghost";
  copyBtn.textContent = "Copy";
  copyBtn.addEventListener("click", () => {
    navigator.clipboard.writeText(state.profile.nexora_id);
    toast("Copied", "success");
  });
  rowId.appendChild(copyBtn);
  s.appendChild(rowId);
  return s;
}

function securitySection() {
  const s = document.createElement("div");
  s.className = "settings-section";
  s.innerHTML = `<h3>🔒 Security</h3>`;

  const rowPwd = document.createElement("div");
  rowPwd.className = "settings-row";
  rowPwd.innerHTML = `<div class="settings-row-info">
    <div class="settings-row-label">Password</div>
    <div class="settings-row-desc">Change your password</div>
  </div>`;
  const changePwdBtn = document.createElement("button");
  changePwdBtn.className = "btn btn-ghost";
  changePwdBtn.textContent = "Change";
  changePwdBtn.addEventListener("click", async () => {
    const v = prompt("New password (min 8 chars):");
    if (!v) return;
    try { await changePassword(v); toast("Password changed", "success"); }
    catch (e) { toast(e.message, "error"); }
  });
  rowPwd.appendChild(changePwdBtn);
  s.appendChild(rowPwd);

  const row2fa = document.createElement("div");
  row2fa.className = "settings-row";
  row2fa.innerHTML = `<div class="settings-row-info">
    <div class="settings-row-label">Two-factor authentication</div>
    <div class="settings-row-desc" id="mfa-status">Checking...</div>
  </div>`;
  const mfaBtn = document.createElement("button");
  mfaBtn.className = "btn btn-ghost";
  mfaBtn.textContent = "Manage";
  row2fa.appendChild(mfaBtn);
  s.appendChild(row2fa);

  const rowSession = document.createElement("div");
  rowSession.className = "settings-row";
  rowSession.innerHTML = `<div class="settings-row-info">
    <div class="settings-row-label">Current session</div>
    <div class="settings-row-desc" id="session-info">Loading...</div>
  </div>`;
  s.appendChild(rowSession);

  (async () => {
    try {
      const factors = await listFactors();
      const totp = (factors && factors.totp) || [];
      const has = totp.length > 0;
      const status = s.querySelector("#mfa-status");
      if (status) status.innerHTML = has
        ? '<span class="badge success">Enabled</span>'
        : '<span class="badge muted">Disabled</span>';
      mfaBtn.textContent = has ? "Disable" : "Enable";
      mfaBtn.onclick = has ? () => disableMfaFlow(totp[0].id) : enableMfaFlow;
    } catch (e) {
      const status = s.querySelector("#mfa-status");
      if (status) status.textContent = "Error: " + e.message;
    }
    try {
      const info = await listActiveSessionInfo();
      const el = s.querySelector("#session-info");
      if (el && info) el.textContent =
        "Last sign in: " + new Date(info.last_sign_in_at).toLocaleString();
    } catch (_) {}
  })();

  return s;
}

async function enableMfaFlow() {
  try {
    const data = await enrollTotp();
    showMfaModal(data, async (code) => {
      await verifyTotp(data.id, code);
      toast("2FA enabled", "success");
      closePanel(); openSettingsPanel();
    });
  } catch (e) { toast(e.message, "error"); }
}

async function disableMfaFlow(factorId) {
  if (!confirm("Disable 2FA?")) return;
  try {
    await unenrollFactor(factorId);
    toast("2FA disabled", "warning");
    closePanel(); openSettingsPanel();
  } catch (e) { toast(e.message, "error"); }
}

function showMfaModal(enrollData, onSuccess) {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <div class="modal-title">Enable 2FA</div>
        <button class="modal-close">×</button>
      </div>
      <div class="modal-body">
        <p style="color:var(--text-2);font-size:13px;margin-bottom:12px">
          Scan the QR code with your authenticator app.
        </p>
        <div class="qr-container" id="qr-holder"></div>
        <p style="font-size:12px;color:var(--text-3);margin-bottom:6px">Manual secret:</p>
        <code id="mfa-secret" style="background:var(--bg-2);padding:8px 12px;border-radius:6px;font-size:12px;display:block;word-break:break-all"></code>
        <div style="margin-top:16px">
          <label class="form-label">Verification code</label>
          <input class="mfa-code-input" id="mfa-code" maxlength="6" inputmode="numeric" placeholder="000000">
        </div>
        <div class="auth-error" id="mfa-error" style="margin-top:10px"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" id="mfa-cancel">Cancel</button>
        <button class="btn btn-primary" id="mfa-verify">Verify</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);

  const holder = backdrop.querySelector("#qr-holder");
  const secretEl = backdrop.querySelector("#mfa-secret");
  const qr = enrollData.totp.qr_code;
  const secret = enrollData.totp.secret;
  secretEl.textContent = secret;

  if (typeof qr === "string" && qr.startsWith("data:")) {
    const img = document.createElement("img");
    img.src = qr; img.alt = "QR code";
    holder.appendChild(img);
  } else if (typeof qr === "string" && qr.startsWith("<svg")) {
    const doc = new DOMParser().parseFromString(qr, "image/svg+xml");
    const svg = doc.documentElement;
    if (svg && svg.tagName.toLowerCase() === "svg")
      holder.appendChild(document.importNode(svg, true));
    else holder.textContent = "QR unavailable. Use secret below.";
  } else holder.textContent = "QR unavailable. Use secret below.";

  const close = () => backdrop.remove();
  backdrop.querySelector(".modal-close").addEventListener("click", close);
  backdrop.querySelector("#mfa-cancel").addEventListener("click", close);
  backdrop.querySelector("#mfa-verify").addEventListener("click", async () => {
    const code = backdrop.querySelector("#mfa-code").value.trim();
    const errEl = backdrop.querySelector("#mfa-error");
    errEl.classList.remove("show");
    if (!/^\d{6}$/.test(code)) {
      errEl.textContent = "Enter 6-digit code";
      errEl.classList.add("show");
      return;
    }
    const btn = backdrop.querySelector("#mfa-verify");
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';
    try { await onSuccess(code); close(); }
    catch (e) {
      errEl.textContent = e.message || "Invalid code";
      errEl.classList.add("show");
    } finally {
      btn.disabled = false;
      btn.textContent = "Verify";
    }
  });
}

function appearanceSection() {
  const s = document.createElement("div");
  s.className = "settings-section";
  s.innerHTML = `<h3>🎨 Appearance</h3>`;

  const row = document.createElement("div");
  row.className = "settings-row";
  row.innerHTML = `<div class="settings-row-info">
    <div class="settings-row-label">Theme</div>
    <div class="settings-row-desc">Choose your preferred look</div>
  </div>`;
  const group = document.createElement("div");
  group.style.display = "flex"; group.style.gap = "6px";
  const themes = [
    { key: "dark", label: "Dark" },
    { key: "light", label: "Light" },
    { key: "system", label: "System" },
  ];
  const current = localStorage.getItem("nexora-theme") || "dark";
  themes.forEach(t => {
    const b = document.createElement("button");
    b.className = "btn " + (current === t.key ? "btn-primary" : "btn-ghost");
    b.textContent = t.label;
    b.dataset.themeChoice = t.key;
    b.addEventListener("click", () => {
      // локальная функция из utils
      import("./utils.js").then(({ applyTheme }) => {
        applyTheme(t.key);
        group.querySelectorAll("button").forEach(x => x.className = "btn btn-ghost");
        b.className = "btn btn-primary";
        toast("Theme: " + t.label, "success");
      });
    });
    group.appendChild(b);
  });
  row.appendChild(group);
  s.appendChild(row);
  return s;
}

function privacySection() {
  const s = document.createElement("div");
  s.className = "settings-section";
  s.innerHTML = `<h3>🛡 Privacy</h3>`;

  const r1 = document.createElement("div");
  r1.className = "settings-row";
  r1.innerHTML = `<div class="settings-row-info">
    <div class="settings-row-label">Discoverable by NEXORA ID</div>
    <div class="settings-row-desc">Allow others to find you</div>
  </div>`;
  const sw1 = document.createElement("div");
  sw1.className = "switch" + (state.profile.findable ? " on" : "");
  r1.appendChild(sw1);
  sw1.addEventListener("click", async () => {
    const next = !sw1.classList.contains("on");
    sw1.classList.toggle("on", next);
    try { await updateProfile({ findable: next }); state.profile.findable = next; toast("Updated", "success"); }
    catch (e) { sw1.classList.toggle("on", !next); toast(e.message, "error"); }
  });
  s.appendChild(r1);

  const r2 = document.createElement("div");
  r2.className = "settings-row";
  r2.innerHTML = `<div class="settings-row-info">
    <div class="settings-row-label">Show online status</div>
    <div class="settings-row-desc">Others can see when you're active</div>
  </div>`;
  const sw2 = document.createElement("div");
  sw2.className = "switch" + (state.profile.show_online ? " on" : "");
  r2.appendChild(sw2);
  sw2.addEventListener("click", async () => {
    const next = !sw2.classList.contains("on");
    sw2.classList.toggle("on", next);
    try { await updateProfile({ show_online: next }); state.profile.show_online = next; toast("Updated", "success"); }
    catch (e) { sw2.classList.toggle("on", !next); toast(e.message, "error"); }
  });
  s.appendChild(r2);

  const r3 = document.createElement("div");
  r3.className = "settings-row";
  r3.innerHTML = `<div class="settings-row-info">
    <div class="settings-row-label">Who can message me</div>
    <div class="settings-row-desc">Control who can start chats</div>
  </div>`;
  const sel = document.createElement("select");
  sel.style.width = "140px";
  ["everyone", "contacts", "nobody"].forEach(v => {
    const o = document.createElement("option");
    o.value = v; o.textContent = v.charAt(0).toUpperCase() + v.slice(1);
    if (state.profile.allow_messages === v) o.selected = true;
    sel.appendChild(o);
  });
  sel.addEventListener("change", async () => {
    try { await updateProfile({ allow_messages: sel.value }); state.profile.allow_messages = sel.value; toast("Updated", "success"); }
    catch (e) { toast(e.message, "error"); }
  });
  r3.appendChild(sel);
  s.appendChild(r3);
  return s;
}

// Импорт функции subscribeToReactions не был подключён явно — делаем это
import { subscribeToReactions } from "./reactions.js";
