import { supabase } from "./supabase.js";

export async function updateProfile(fields) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const patch = {};
  if (fields.username !== undefined) {
    const u = String(fields.username).trim();
    if (u.length < 3 || u.length > 24 || !/^[a-zA-Z0-9_]+$/.test(u)) {
      throw new Error("Username must be 3–24 chars: letters, digits, underscore");
    }
    patch.username = u;
  }
  if (fields.about !== undefined) patch.about = String(fields.about).slice(0, 300);
  if (fields.avatar_url !== undefined) patch.avatar_url = fields.avatar_url;
  if (fields.findable !== undefined) patch.findable = !!fields.findable;
  if (fields.allow_messages !== undefined) patch.allow_messages = fields.allow_messages;
  if (fields.show_online !== undefined) patch.show_online = !!fields.show_online;

  if (Object.keys(patch).length === 0) return null;

  const { data, error } = await supabase
    .from("profiles")
    .update(patch)
    .eq("id", user.id)
    .select()
    .single();

  if (error) {
    if (error.code === "23505") throw new Error("Username is already taken");
    throw error;
  }
  return data;
}

export async function uploadAvatar(file) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  if (!file.type.startsWith("image/")) throw new Error("Only images allowed");
  if (file.size > 2 * 1024 * 1024) throw new Error("Max 2MB");

  const ext = (file.name.split(".").pop() || "png").toLowerCase();
  const path = `${user.id}/avatar.${ext}`;

  const { error: upErr } = await supabase.storage
    .from("avatars")
    .upload(path, file, { upsert: true, cacheControl: "3600" });
  if (upErr) throw upErr;

  const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
  const url = pub.publicUrl + "?t=" + Date.now();

  await updateProfile({ avatar_url: url });
  return url;
}

export async function searchUserByQuery(query) {
  const q = String(query || "").trim();
  if (!q) return null;
  const { data, error } = await supabase.rpc("search_user", { query: q });
  if (error) throw error;
  return data && data.length ? data[0] : null;
}

export async function getUserProfile(userId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();
  if (error) throw error;

  // Добавь в конец js/profile.js

export async function setSystemAvatar(dataUrl) {
  return updateProfile({ system_avatar: dataUrl, avatar_url: null });
}

export async function clearAvatar() {
  return updateProfile({ system_avatar: null, avatar_url: null });
}
  return data;
}
