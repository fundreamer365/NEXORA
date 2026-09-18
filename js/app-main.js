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

    const wrap
