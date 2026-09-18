// Системные аватарки: SVG-градиенты с буквой.
// Хранятся как data-URL в profiles.system_avatar — не занимают Storage.

const PALETTES = [
  ["#7c5cff", "#4d3fbf"],  // nexus
  ["#ff5a6e", "#b8295c"],  // crimson
  ["#3ddc84", "#1f8f52"],  // mint
  ["#4da6ff", "#1f5d9e"],  // ocean
  ["#ffb547", "#a3690e"],  // amber
  ["#ff6ad5", "#a83c86"],  // magenta
  ["#5ce1e6", "#2a8f94"],  // cyan
  ["#a78bfa", "#6d4fd6"],  // violet
  ["#f472b6", "#9d1e64"],  // pink
  ["#34d399", "#0f7a5a"],  // emerald
  ["#facc15", "#a17400"],  // gold
  ["#fb7185", "#991b1b"],  // rose
];

function svgDataUrl(initial, c1, c2, id) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
<defs><linearGradient id="g${id}" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/>
</linearGradient></defs>
<rect width="100" height="100" rx="50" fill="url(#g${id})"/>
<text x="50" y="65" text-anchor="middle" font-family="-apple-system,Segoe UI,Roboto,sans-serif" font-size="46" font-weight="700" fill="#fff">${initial}</text>
</svg>`;
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}

/**
 * Возвращает массив системных аватарок для текущего пользователя.
 * Первая буква username используется в SVG.
 */
export function buildSystemAvatars(username) {
  const initial = (username || "?").trim().charAt(0).toUpperCase() || "?";
  return PALETTES.map((p, i) => ({
    id: "sys-" + i,
    url: svgDataUrl(initial, p[0], p[1], i),
  }));
}

/**
 * Определяет URL аватара пользователя: приоритет — загруженный, потом системный.
 */
export function resolveAvatarUrl(profile) {
  if (!profile) return null;
  if (profile.avatar_url) return profile.avatar_url;
  if (profile.system_avatar) {
    // Если сохранён data-URL с прежней буквой — перегенерируем с актуальной
    const initial = (profile.username || "?").trim().charAt(0).toUpperCase();
    // Извлекаем индекс палитры из id или восстанавливаем из data-URL невозможно — храним id
    // Мы храним id вида "sys-N" — но так как в system_avatar мы сохраняем сам data-URL,
    // просто вернём его как есть.
    return profile.system_avatar;
  }
  return null;
}

export function systemAvatarById(id, username) {
  const idx = parseInt(String(id).replace("sys-", ""), 10);
  if (isNaN(idx) || idx < 0 || idx >= PALETTES.length) return null;
  const initial = (username || "?").trim().charAt(0).toUpperCase() || "?";
  const p = PALETTES[idx];
  return svgDataUrl(initial, p[0], p[1], idx);
}

export const SYSTEM_PALETTES = PALETTES;
