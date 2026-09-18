import { supabase } from "./supabase.js";

const MAX_SIZE = 50 * 1024 * 1024; // 50 MB

/**
 * Определяет kind сообщения по MIME-типу.
 */
export function kindFromFile(file) {
  const t = (file.type || "").toLowerCase();
  if (t.startsWith("image/")) return "image";
  if (t.startsWith("video/")) return "video";
  return "file";
}

/**
 * Загружает файл в bucket attachments и возвращает { url, kind, name, size }.
 */
export async function uploadAttachment(file, chatId) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  if (file.size > MAX_SIZE) throw new Error("File too large (max 50 MB)");

  const safeName = file.name.replace(/[^\w.\-]+/g, "_").slice(0, 80);
  const path = `${user.id}/${chatId}/${Date.now()}-${Math.random().toString(36).slice(2,8)}-${safeName}`;

  const { error: upErr } = await supabase.storage
    .from("attachments")
    .upload(path, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type || "application/octet-stream",
    });
  if (upErr) throw upErr;

  const { data: pub } = supabase.storage.from("attachments").getPublicUrl(path);
  return {
    url: pub.publicUrl,
    kind: kindFromFile(file),
    name: file.name,
    size: file.size,
  };
}

export function humanFileSize(bytes) {
  if (!bytes) return "";
  const units = ["B","KB","MB","GB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}
