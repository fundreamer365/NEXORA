// ============================================================
// Toast system
// ============================================================
export function toast(message, type = "info", title = null) {
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    document.body.appendChild(container);
  }

  const icons = { success: "✓", error: "✕", warning: "!", info: "i" };
  const titles = { success: "Success", error: "Error", warning: "Warning", info: "Info" };

  const el = document.createElement("div");
  el.className = `toast ${type}`;

  const icon = document.createElement("div");
  icon.className = "toast-icon";
  icon.textContent = icons[type] || "i";

  const body = document.createElement("div");
  body.className = "toast-body";
  const t = document.createElement("div");
  t.className = "toast-title";
  t.textContent = title || titles[type] || "Info";
  const m = document.createElement("div");
  m.className = "toast-msg";
  m.textContent = message;
  body.appendChild(t);
  body.appendChild(m);

  el.appendChild(icon);
  el.appendChild(body);
  container.appendChild(el);

  setTimeout(() => {
    el.classList.add("removing");
    setTimeout(() => el.remove(), 300);
  }, 3500);
}

// ============================================================
// Markdown → безопасный HTML
// Полностью экранируем HTML перед разметкой.
// ============================================================
export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Безопасный парсер сообщений.
 * Порядок: escape → markdown → URL-автолинк (безопасный).
 */
export function formatMessage(raw) {
  let text = escapeHtml(raw);

  // Код `...` — до всего остального
  text = text.replace(/`([^`\n]+)`/g, (_, c) => `<code>${c}</code>`);

  // Жирный **...**
  text = text.replace(/\*\*([^\n*]+?)\*\*/g, "<strong>$1</strong>");

  // Курсив *...*
  text = text.replace(/(^|[^*])\*([^\n*]+?)\*(?!\*)/g, "$1<em>$2</em>");

  // Зачёркнутый ~~...~~
  text = text.replace(/~~([^\n~]+?)~~/g, "<del>$1</del>");

  // Цитата > в начале строки
  text = text.replace(/(^|\n)&gt;\s?(.+)/g, "$1<blockquote>$2</blockquote>");

  // Markdown-ссылки [text](url)
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label, url) => {
    const safe = escapeAttr(url);
    // Проверяем схему после escape
    if (!/^https?:\/\//i.test(url)) return label;
    return `<a href="${safe}" target="_blank" rel="noopener noreferrer nofollow">${label}</a>`;
  });

  // Автолинк обычных URL (не внутри href / уже сформированных ссылок).
  // Обрабатываем через токенизацию — чтобы не сломать существующие <a>.
  const parts = [];
  let lastIndex = 0;
  const existingLinkRe = /<a [^>]*>.*?<\/a>/g;
  let m;
  while ((m = existingLinkRe.exec(text)) !== null) {
    parts.push(autolink(text.slice(lastIndex, m.index)));
    parts.push(m[0]);
    lastIndex = m.index + m[0].length;
  }
  parts.push(autolink(text.slice(lastIndex)));
  text = parts.join("");

  // Переносы строк
  text = text.replace(/\n/g, "<br>");

  return text;
}

function autolink(segment) {
  // Не трогаем содержимое внутри <code>...</code> — упрощённо: пропускаем сегменты в тегах
  return segment.replace(
    /(^|[\s>])((?:https?:\/\/)[^\s<]+)/g,
    (_, prefix, url) => {
      const safe = escapeAttr(url);
      return `${prefix}<a href="${safe}" target="_blank" rel="noopener noreferrer nofollow">${url}</a>`;
    }
  );
}

// ============================================================
// Время
// ============================================================
export function formatTime(iso) {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) {
    return "Yesterday " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { day: "2-digit", month: "short" }) + " " +
    d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function formatDateLabel(iso) {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return "Today";
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { day: "numeric", month: "long", year: "numeric" });
}

// ============================================================
// Avatar helper
// ============================================================
export function avatarNode(user, size = "md") {
  const el = document.createElement("div");
  el.className = `avatar avatar-${size}`;
  if (user?.avatar_url) {
    const img = document.createElement("img");
    img.src = user.avatar_url;
    img.alt = user.username || "";
    img.onerror = () => { img.remove(); el.textContent = initials(user?.username); };
    el.appendChild(img);
  } else {
    el.textContent = initials(user?.username);
  }
  return el;
}

export function initials(name) {
  if (!name) return "?";
  return name.trim().charAt(0).toUpperCase();
}

// ============================================================
// Debounce
// ============================================================
export function debounce(fn, ms = 300) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// ============================================================
// Валидация
// ============================================================
export function validateUsername(u) {
  if (!u) return "Username is required";
  if (u.length < 3 || u.length > 24) return "Username must be 3–24 characters";
  if (!/^[a-zA-Z0-9_]+$/.test(u)) return "Only letters, digits and underscore";
  return null;
}

export function validateEmail(e) {
  if (!e) return "Email is required";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return "Invalid email";
  return null;
}

export function validatePassword(p) {
  if (!p) return "Password is required";
  if (p.length < 8) return "Password must be at least 8 characters";
  return null;
}

// ============================================================
// Theme
// ============================================================
export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === "system") {
    const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    root.setAttribute("data-theme", dark ? "dark" : "light");
  } else {
    root.setAttribute("data-theme", theme);
  }
  localStorage.setItem("nexora-theme", theme);
}

export function initTheme() {
  const saved = localStorage.getItem("nexora-theme") || "dark";
  applyTheme(saved);
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if ((localStorage.getItem("nexora-theme") || "dark") === "system") applyTheme("system");
  });
  return saved;
}
