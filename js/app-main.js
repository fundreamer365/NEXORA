import { supabase } from "./supabase.js";
import {
  toast, initTheme, avatarNode, debounce, formatTime, formatMessage,
  escapeHtml, initials
} from "./utils.js";
import {
  getSession, getCurrentProfile, logout, setOnlineStatus
} from "./auth.js";
import {
  searchUserByQuery, updateProfile, uploadAvatar, getUserProfile
} from "./profile.js";
import {
  listContacts, addContact, removeContact, isContact
} from "./contacts.js";
import {
  openDirectChat, listChats, loadMessages, sendMessage,
  subscribeToChat, unsubscribeFromChat, renderMessage,
  subscribeToProfiles, closeContextMenu
} from "./chat.js";
import {
  initAppearanceSettings, initPrivacySettings, updateEmail
} from "./settings.js";
import {
  listFactors, enrollTotp, verifyTotp, unenrollFactor, changePassword,
  requiresMfaChallenge, listActiveSessionInfo
} from "./security.js";

// ============================================================
// Global state
// ============================================================
const state = {
  user: null,
  profile: null,
  activeChatId: null,
  activeChatPeer: null,
  chats: [],
  contacts: [],
  activeTab: "chats",
  profileSubChannel: null,
};

// ============================================================
// Boot
// ============================================================
initTheme();

document.addEventListener("DOMContentLoaded", boot);

async function boot() {
  const session = await getSession();
  if (!session) {
    window.location.href = "login.html";
    return;
  }
  state.user = session.user;

  // Проверка на MFA challenge
  if (await requiresMfaChallenge()) {
    window.location.href = "login.html?mfa=1";
    return;
  }

  try {
    state.profile = await getCurrentProfile();
  } catch (e) {
    toast("Failed to load profile", "error");
    return;
  }

  await setOnlineStatus(true);

  // Обработка beforeunload
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
// UI bindings
// ============================================================
function bindEvents() {
  // Sidebar tabs
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      state.activeTab = btn.dataset.tab;
      renderSidebarBody();
    });
  });

  // Search
  const searchInput = document.getElementById("sidebar-search");
  searchInput.addEventListener("input", debounce(e => {
    state.searchQuery = e.target.value.trim();
    renderSidebarBody();
  }, 200));

  // Sidebar footer / profile
  document.getElementById("sidebar-footer").addEventListener("click", openProfilePanel);

  // Panels close
  document.querySelectorAll("[data-close-panel]").forEach(el => {
    el.addEventListener("click", closePanel);
  });

  // Send button
  const composer = document.getElementById("composer-input");
  const sendBtn = document.getElementById("send-btn");
  if (composer && sendBtn) {
    composer.addEventListener("input", () => autoResize(composer));
    composer.addEventListener("keydown", e => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendBtn.click();
      }
    });
    sendBtn.addEventListener("click", onSendMessage);
  }

  // Mobile menu
  const mobileBtn = document.getElementById("mobile-menu-btn");
  if (mobileBtn) {
    mobileBtn.addEventListener("click", () => {
      document.getElementById("sidebar").classList.remove("hidden-mobile");
    });
  }
  document.getElementById("sidebar").addEventListener("click", e => {
    if (window.innerWidth <= 860 && e.target.closest(".list-item")) {
      document.getElementById("sidebar").classList.add("hidden-mobile");
    }
  });

  document.addEventListener("click", closeContextMenu);
}

function autoResize(ta) {
  ta.style.height = "auto";
  ta.style.height = Math.min(ta.scrollHeight, 140) + "px";
}

// ============================================================
// Sidebar: footer
// ============================================================
function renderSidebarFooter() {
  const el = document.getElementById("sidebar-footer");
  el.innerHTML = "";

  const av = avatarNode(state.profile, "md");
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
  settingsBtn.addEventListener("click", e => {
    e.stopPropagation();
    openSettingsPanel();
  });

  el.appendChild(av);
  el.appendChild(body);
  el.appendChild(settingsBtn);
}

// ============================================================
// Sidebar body: chats / contacts / search results
// ============================================================
function renderSidebarBody() {
  const body = document.getElementById("sidebar-body");
  body.innerHTML = "";

  const q = state.searchQuery || "";

  if (q) {
    renderSearchResults(body, q);
    return;
  }

  if (state.activeTab === "chats") renderChatsList(body);
  else if (state.activeTab === "contacts") renderContactsList(body);
}

async function renderSearchResults(container, query) {
  const loading = document.createElement("div");
  loading.className = "empty-state";
  loading.innerHTML = '<span class="spinner"></span>';
  container.appendChild(loading);

  let result = null;
  try {
    result = await searchUserByQuery(query);
  } catch (e) {
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
      await openChat(chatId, user);
      if (window.innerWidth <= 860) {
        document.getElementById("sidebar").classList.add("hidden-mobile");
      }
    } catch (e) {
      toast(e.message, "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "Message";
    }
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
    e.textContent = "No chats yet. Find a user by NEXORA ID above to start.";
    container.appendChild(e);
    return;
  }

  state.chats.forEach(chat => {
    const item = document.createElement("div");
    item.className = "list-item" + (chat.id === state.activeChatId ? " active" : "");
    item.dataset.chatId = chat.id;

    const peer = chat.other_user || { username: chat.title || "Chat" };
    const av = avatarNode(peer, "md");

    const body = document.createElement("div");
    body.className = "list-item-body";

    const title = document.createElement("div");
    title.className = "list-item-title";
    const titleName = document.createElement("span");
    titleName.textContent = peer.username || "Chat";
    const titleTime = document.createElement("span");
    titleTime.className = "list-item-time";
    if (chat.last_message) titleTime.textContent = formatTime(chat.last_message.created_at);
    title.appendChild(titleName);
    title.appendChild(titleTime);

    const sub = document.createElement("div");
    sub.className = "list-item-sub";
    if (chat.last_message) {
      sub.textContent = (chat.last_message.is_own ? "You: " : "") +
        chat.last_message.content.slice(0, 60);
    } else {
      sub.textContent = "No messages yet";
    }

    body.appendChild(title);
    body.appendChild(sub);

    item.appendChild(av);
    item.appendChild(body);

    item.addEventListener("click", async () => {
      await openChat(chat.id, peer);
      if (window.innerWidth <= 860) {
        document.getElementById("sidebar").classList.add("hidden-mobile");
      }
    });

    container.appendChild(item);
  });
}

function renderContactsList(container) {
  if (!state.contacts.length) {
    const e = document.createElement("div");
    e.className = "empty-state";
    e.textContent = "No contacts. Search for a NEXORA ID to add someone.";
    container.appendChild(e);
    return;
  }

  state.contacts.forEach(c => {
    const item = document.createElement("div");
    item.className = "list-item";

    const av = avatarNode(c, "md");
    const body = document.createElement("div");
    body.className = "list-item-body";

    const title = document.createElement("div");
    title.className = "list-item-title";
    const nameSpan = document.createElement("span");
    nameSpan.textContent = c.username;
    title.appendChild(nameSpan);

    const sub = document.createElement("div");
    sub.className = "list-item-sub";
    sub.textContent = c.nexora_id + (c.is_online && c.show_online ? " · online" : "");

    body.appendChild(title);
    body.appendChild(sub);
    item.appendChild(av);
    item.appendChild(body);

    const msgBtn = document.createElement("button");
    msgBtn.className = "btn btn-ghost";
    msgBtn.textContent = "Open";
    msgBtn.style.padding = "4px 10px";
    msgBtn.style.fontSize = "12px";
    msgBtn.addEventListener("click", async e => {
      e.stopPropagation();
      const chatId = await openDirectChat(c.user_id);
      await refreshChats();
      await openChat(chatId, c);
    });

    item.appendChild(msgBtn);
    container.appendChild(item);
  });
}

async function refreshChats() {
  try {
    state.chats = await listChats();
    renderSidebarBody();
  } catch (e) { toast(e.message, "error"); }
}

async function refreshContacts() {
  try {
    state.contacts = await listContacts();
    renderSidebarBody();
  } catch (e) { toast(e.message, "error"); }
}

// ============================================================
// Открытие чата
// ============================================================
async function openChat(chatId, peer) {
  closePanel();
  state.activeChatId = chatId;
  state.activeChatPeer = peer;

  document.getElementById("welcome").classList.add("hidden");
  const chatView = document.getElementById("chat-view");
  chatView.classList.remove("hidden");

  renderChatHeader(peer);

  const messagesEl = document.getElementById("messages");
  messagesEl.innerHTML = "";

  let msgs = [];
  try {
    msgs = await loadMessages(chatId);
  } catch (e) { toast("Failed to load messages", "error"); }

  let prev = null;
  for (const m of msgs) {
    renderMessage(m, state.user.id, messagesEl, prev);
    prev = m;
  }
  scrollToBottom();

  unsubscribeFromChat();
  subscribeToChat(chatId, {
    onInsert: m => onRealtimeInsert(m),
    onUpdate: m => onRealtimeUpdate(m),
    onDelete: m => onRealtimeDelete(m),
  });

  refreshChats();
}

function renderChatHeader(peer) {
  const header = document.getElementById("chat-header");
  header.innerHTML = "";

  const av = avatarNode(peer, "md");

  const body = document.createElement("div");
  body.className = "chat-header-body";

  const name = document.createElement("div");
  name.className = "chat-header-name";
  name.textContent = peer?.username || "Chat";

  const dot = document.createElement("span");
  dot.className = "online-dot" + (peer?.is_online && peer?.show_online !== false ? " online" : "");
  name.appendChild(dot);

  const id = document.createElement("div");
  id.className = "chat-header-id";
  id.textContent = peer?.nexora_id || "";

  body.appendChild(name);
  body.appendChild(id);

  header.appendChild(av);
  header.appendChild(body);
}

// ============================================================
// Realtime handlers
// ============================================================
function onRealtimeInsert(m) {
  if (m.chat_id !== state.activeChatId) {
    refreshChats();
    return;
  }
  // Игнорируем эхо собственного сообщения — уже отрисовано
  if (m.sender_id === state.user.id) return;

  const container = document.getElementById("messages");
  const rows = container.querySelectorAll(".msg-row");
  const lastRow = rows[rows.length - 1];
  const lastMsg = lastRow ? { created_at: lastRow.dataset.createdAt } : null;

  // Найдём последнее реальное сообщение по data-атрибуту (мы его не ставим, но можем взять дату из DOM-порядка).
  // Проще: разделитель отрисуем, если последний элемент — не .msg-row или его дата отличается.
  const lastMsgEl = Array.from(container.querySelectorAll(".msg-row")).pop();
  const prevMsgObj = lastMsgEl ? getMsgFromRow(lastMsgEl) : null;

  renderMessage(m, state.user.id, container, prevMsgObj);
  // Пометим дату в data атрибут
  const newRow = Array.from(container.querySelectorAll(".msg-row")).pop();
  if (newRow) newRow.dataset.createdAt = m.created_at;
  scrollToBottom();
  refreshChats();
}

// Храним сообщения на элементе
const messagesStore = new Map();
export function cacheMessage(m) { messagesStore.set(m.id, m); }

function getMsgFromRow(rowEl) {
  const id = rowEl.dataset.messageId;
  return messagesStore.get(id) || { created_at: rowEl.dataset.createdAt };
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
    renderChatHeader(state.activeChatPeer);
  }
  // Обновим в контактах
  const idx = state.contacts.findIndex(c => c.user_id === p.id);
  if (idx >= 0) {
    state.contacts[idx].is_online = p.is_online;
    state.contacts[idx].username = p.username;
    state.contacts[idx].avatar_url = p.avatar_url;
    renderSidebarBody();
  }
  // Обновим в чатах
  state.chats.forEach(c => {
    if (c.other_user && c.other_user.id === p.id) {
      c.other_user.is_online = p.is_online;
      c.other_user.username = p.username;
      c.other_user.avatar_url = p.avatar_url;
      c.other_user.show_online = p.show_online;
    }
  });
}

// ============================================================
// Отправка сообщения
// ============================================================
async function onSendMessage() {
  const input = document.getElementById("composer-input");
  const content = input.value.trim();
  if (!content || !state.activeChatId) return;

  input.value = "";
  autoResize(input);

  const optimistic = {
    id: "temp-" + Date.now(),
    chat_id: state.activeChatId,
    sender_id: state.user.id,
    content,
    edited_at: null,
    created_at: new Date().toISOString(),
  };
  const container = document.getElementById("messages");
  renderMessage(optimistic, state.user.id, container, getLastMsgFromDom());
  scrollToBottom();

  try {
    const saved = await sendMessage(state.activeChatId, content);
    // Заменим temp id
    const tempRow = document.querySelector(`.msg-row[data-message-id="${optimistic.id}"]`);
    if (tempRow) {
      tempRow.dataset.messageId = saved.id;
      tempRow.dataset.createdAt = saved.created_at;
    }
    cacheMessage(saved);
    refreshChats();
  } catch (e) {
    toast(e.message, "error");
    const tempRow = document.querySelector(`.msg-row[data-message-id="${optimistic.id}"]`);
    if (tempRow) tempRow.remove();
  }
}

function getLastMsgFromDom() {
  const rows = document.querySelectorAll(".msg-row");
  const last = rows[rows.length - 1];
  if (!last) return null;
  return { created_at: last.dataset.createdAt || new Date().toISOString() };
}

function scrollToBottom() {
  const el = document.getElementById("messages");
  requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
}

// ============================================================
// Panels
// ============================================================
function closePanel() {
  document.querySelectorAll(".panel").forEach(p => p.remove());
}

// ============================================================
// Welcome
// ============================================================
function renderWelcome() {
  const w = document.getElementById("welcome");
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
  hint.textContent = "Search a NEXORA ID or pick a chat on the left.";
  w.appendChild(logo);
  w.appendChild(tag);
  w.appendChild(hint);
}

// ============================================================
// Profile panel
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

  const avWrap = document.createElement("div");
  avWrap.style.position = "relative";
  const av = avatarNode(state.profile, "xl");
  avWrap.appendChild(av);

  const changeAv = document.createElement("input");
  changeAv.type = "file";
  changeAv.accept = "image/*";
  changeAv.style.display = "none";
  changeAv.addEventListener("change", async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      toast("Uploading...", "info");
      const url = await uploadAvatar(file);
      state.profile.avatar_url = url;
      renderSidebarFooter();
      openProfilePanel();
      toast("Avatar updated", "success");
    } catch (err) { toast(err.message, "error"); }
  });
  avWrap.appendChild(changeAv);

  const uploadBtn = document.createElement("button");
  uploadBtn.className = "btn btn-ghost";
  uploadBtn.style.position = "absolute";
  uploadBtn.style.bottom = "0";
  uploadBtn.style.right = "0";
  uploadBtn.style.padding = "6px 10px";
  uploadBtn.style.borderRadius = "50%";
  uploadBtn.style.width = "36px";
  uploadBtn.style.height = "36px";
  uploadBtn.textContent = "📷";
  uploadBtn.addEventListener("click", () => changeAv.click());
  avWrap.appendChild(uploadBtn);

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

  hero.appendChild(avWrap);
  hero.appendChild(name);
  hero.appendChild(idEl);
  body.appendChild(hero);

  // Edit username
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

  // Logout
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

  // Account
  body.appendChild(accountSection());
  // Security
  body.appendChild(securitySection());
  // Appearance
  body.appendChild(appearanceSection());
  // Privacy
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

  const rowEmail = document.createElement("div");
  rowEmail.className = "settings-row";
  rowEmail.innerHTML = `
    <div class="settings-row-info">
      <div class="settings-row-label">Email</div>
      <div class="settings-row-desc">${escapeHtml(state.user.email || "")}</div>
    </div>
  `;
  const changeEmailBtn = document.createElement("button");
  changeEmailBtn.className = "btn btn-ghost";
  changeEmailBtn.textContent = "Change";
  changeEmailBtn.addEventListener("click", () => {
    const v = prompt("New email:");
    if (!v) return;
    updateEmail(v).then(() => toast("Check your inbox to confirm", "info"))
      .catch(e => toast(e.message, "error"));
  });
  rowEmail.appendChild(changeEmailBtn);
  s.appendChild(rowEmail);

  return s;
}

function securitySection() {
  const s = document.createElement("div");
  s.className = "settings-section";
  s.innerHTML = `<h3>🔒 Security</h3>`;

  // Password
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
    try {
      await changePassword(v);
      toast("Password changed", "success");
    } catch (e) { toast(e.message, "error"); }
  });
  rowPwd.appendChild(changePwdBtn);
  s.appendChild(rowPwd);

  // 2FA
  const row2fa = document.createElement("div");
  row2fa.className = "settings-row";
  row2fa.innerHTML = `<div class="settings-row-info">
    <div class="settings-row-label">Two-factor authentication</div>
    <div class="settings-row-desc" id="mfa-status">Checking...</div>
  </div>`;
  const mfaBtn = document.createElement("button");
  mfaBtn.className = "btn btn-ghost";
  mfaBtn.textContent = "Manage";
  mfaBtn.id = "mfa-btn";
  row2fa.appendChild(mfaBtn);
  s.appendChild(row2fa);

  // Session info
  const rowSession = document.createElement("div");
  rowSession.className = "settings-row";
  rowSession.innerHTML = `<div class="settings-row-info">
    <div class="settings-row-label">Current session</div>
    <div class="settings-row-desc" id="session-info">Loading...</div>
  </div>`;
  s.appendChild(rowSession);

  // Load state
  (async () => {
    try {
      const factors = await listFactors();
      const totp = factors.totp || [];
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
        `Last sign in: ${new Date(info.last_sign_in_at).toLocaleString()}`;
    } catch {}
  })();

  return s;
}

async function enableMfaFlow() {
  try {
    const data = await enrollTotp();
    showMfaModal(data, async code => {
      await verifyTotp(data.id, code);
      toast("2FA enabled", "success");
      closePanel();
      openSettingsPanel();
    });
  } catch (e) { toast(e.message, "error"); }
}

async function disableMfaFlow(factorId) {
  if (!confirm("Disable 2FA?")) return;
  try {
    await unenrollFactor(factorId);
    toast("2FA disabled", "warning");
    closePanel();
    openSettingsPanel();
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
          Scan the QR code with your authenticator app (Google Authenticator, Authy, 1Password).
        </p>
        <div class="qr-container" id="qr-holder"></div>
        <p style="font-size:12px;color:var(--text-3);margin-bottom:6px">Manual secret:</p>
        <code style="background:var(--bg-2);padding:8px 12px;border-radius:6px;font-size:12px;display:block;word-break:break-all">${escapeHtml(enrollData.totp.secret)}</code>
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

  // QR — Supabase возвращает SVG строку в enrollData.totp.qr_code
  const holder = backdrop.querySelector("#qr-holder");
  try {
    // qr_code — data URL или SVG-строка
    const qr = enrollData.totp.qr_code;
    if (qr.startsWith("data:")) {
      const img = document.createElement("img");
      img.src = qr;
      holder.appendChild(img);
    } else if (qr.startsWith("<svg")) {
      holder.innerHTML = qr;
    } else {
      // fallback: показать только secret
      holder.textContent = "QR unavailable. Use secret below.";
    }
  } catch {
    holder.textContent = "QR unavailable. Use secret below.";
  }

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
    try {
      await onSuccess(code);
      close();
    } catch (e) {
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
  group.style.display = "flex";
  group.style.gap = "6px";

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
      applyTheme(t.key);
      group.querySelectorAll("button").forEach(x => {
        x.className = "btn btn-ghost";
      });
      b.className = "btn btn-primary";
      toast(`Theme: ${t.label}`, "success");
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

  // findable
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
    try {
      await updateProfile({ findable: next });
      toast("Privacy updated", "success");
    } catch (e) { sw1.classList.toggle("on", !next); toast(e.message, "error"); }
  });
  s.appendChild(r1);

  // show online
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
    try {
      await updateProfile({ show_online: next });
      toast("Privacy updated", "success");
    } catch (e) { sw2.classList.toggle("on", !next); toast(e.message, "error"); }
  });
  s.appendChild(r2);

  // allow messages
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
    o.value = v;
    o.textContent = v.charAt(0).toUpperCase() + v.slice(1);
    if (state.profile.allow_messages === v) o.selected = true;
    sel.appendChild(o);
  });
  sel.addEventListener("change", async () => {
    try {
      await updateProfile({ allow_messages: sel.value });
      toast("Privacy updated", "success");
    } catch (e) { toast(e.message, "error"); }
  });
  r3.appendChild(sel);
  s.appendChild(r3);

  return s;
}
