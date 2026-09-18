import { supabase } from "./supabase.js";

export async function listContacts() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from("contacts")
    .select("contact_id, created_at, profile:profiles!contacts_contact_id_fkey(*)")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data || []).map((r) => ({
    user_id: r.contact_id,
    username: r.profile ? r.profile.username : null,
    nexora_id: r.profile ? r.profile.nexora_id : null,
    avatar_url: r.profile ? r.profile.avatar_url : null,
    is_online: r.profile ? r.profile.is_online : false,
    show_online: r.profile ? r.profile.show_online : true,
    about: r.profile ? r.profile.about : "",
  }));
}

export async function addContact(contactId) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  if (user.id === contactId) throw new Error("Cannot add yourself");

  const { error } = await supabase
    .from("contacts")
    .insert({ owner_id: user.id, contact_id: contactId });

  if (error && error.code !== "23505") throw error;
}

export async function isContact(contactId) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data, error } = await supabase
    .from("contacts")
    .select("id")
    .eq("owner_id", user.id)
    .eq("contact_id", contactId)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

export async function removeContact(contactId) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { error } = await supabase
    .from("contacts")
    .delete()
    .eq("owner_id", user.id)
    .eq("contact_id", contactId);
  if (error) throw error;
}
