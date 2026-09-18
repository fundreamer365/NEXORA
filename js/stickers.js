import { supabase } from "./supabase.js";

// Системные стикеры: рисуются как SVG data-URL, ничего не грузим в Storage.
const SYSTEM_STICKERS = [
  { id: "sys-heart",   name: "Heart",    svg: bigEmoji("❤️") },
  { id: "sys-fire",    name: "Fire",     svg: bigEmoji("🔥") },
  { id: "sys-star",    name: "Star",     svg: bigEmoji("⭐") },
  { id: "sys-thumb",   name: "Thumb",    svg: bigEmoji("👍") },
  { id: "sys-cry",     name: "Cry",      svg: bigEmoji("😭") },
  { id: "sys-laugh",   name: "Laugh",    svg: bigEmoji("😂") },
  { id: "sys-cool",    name: "Cool",     svg: bigEmoji("😎") },
  { id: "sys-party",   name: "Party",    svg: bigEmoji("🥳") },
  { id: "sys-ghost",   name: "Ghost",    svg: bigEmoji("👻") },
  { id: "sys-alien",   name: "Alien",    svg: bigEmoji("👽") },
  { id: "sys-skull",   name: "Skull",    svg: bigEmoji("💀") },
  { id: "sys-rocket",  name: "Rocket",   svg: bigEmoji("🚀") },
  { id: "sys-cat",     name: "Cat",      svg: bigEmoji("🐱") },
  { id: "sys-dog",     name: "Dog",      svg: bigEmoji("🐶") },
  { id: "sys-unicorn", name: "Unicorn",  svg: bigEmoji("🦄") },
  { id: "sys-pizza",   name: "Pizza",    svg: bigEmoji("🍕") },
];

function bigEmoji(emoji) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
<text x="50" y="72" text-anchor="middle" font-size="72">${emoji}</text></svg>`;
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}

export function listSystemStickers() {
  return SYSTEM_STICKERS.map(s => ({ id: s.id, name: s.name, url: s.svg, system: true }));
}

export function getSystemStickerById(id) {
  return SYSTEM_STICKERS.find(s => s.id === id) || null;
}

export async function listCustomStickers() {
  const { data, error } = await supabase
    .from("stickers")
    .select("id, name, url, pack, uploaded_by, created_at")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map(s => ({ ...s, system: false }));
}

export async function uploadSticker(file, name) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  if (!file.type.startsWith("image/")) throw new Error("Only images allowed");
  if (file.size > 2 * 1024 * 1024) throw new Error("Max 2MB");

  const ext = (file.name.split(".").pop() || "png").toLowerCase();
  const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2,8)}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from("stickers")
    .upload(path, file, { cacheControl: "3600", upsert: false });
  if (upErr) throw upErr;

  const { data: pub } = supabase.storage.from("stickers").getPublicUrl(path);
  const url = pub.publicUrl;

  const { data, error } = await supabase
    .from("stickers")
    .insert({ pack: "custom", name: name || "custom", url, uploaded_by: user.id })
    .select()
    .single();
  if (error) throw error;
  return { ...data, system: false };
}

export async function deleteSticker(id) {
  // Найдём URL, чтобы удалить файл из Storage
  const { data: row } = await supabase.from("stickers").select("url").eq("id", id).single();
  if (row && row.url) {
    const prefix = "/storage/v1/object/public/stickers/";
    const idx = row.url.indexOf(prefix);
    if (idx >= 0) {
      const path = row.url.substring(idx + prefix.length);
      await supabase.storage.from("stickers").remove([path]).catch(() => {});
    }
  }
  const { error } = await supabase.from("stickers").delete().eq("id", id);
  if (error) throw error;
}
