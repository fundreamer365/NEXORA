import { supabase } from "./supabase.js";
import { toast, validateUsername, validateEmail, validatePassword } from "./utils.js";

// ============================================================
// Регистрация
// ============================================================
export async function register(email, password, username) {
  const uErr = validateUsername(username);
  if (uErr) throw new Error(uErr);
  const eErr = validateEmail(email);
  if (eErr) throw new Error(eErr);
  const pErr = validatePassword(password);
  if (pErr) throw new Error(pErr);

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { username },
      emailRedirectTo: window.location.origin + "/login.html",
    },
  });
  if (error) throw error;

  // Проверка: если пользователь уже существует, Supabase может вернуть пустой identities
  if (data.user && data.user.identities && data.user.identities.length === 0) {
    throw new Error("This email is already registered");
  }

  return data;
}

// ============================================================
// Вход
// ============================================================
export async function login(email, password) {
  const eErr = validateEmail(email);
  if (eErr) throw new Error(eErr);
  if (!password) throw new Error("Password is required");

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

// ============================================================
// Выход
// ============================================================
export async function logout() {
  await setOnlineStatus(false).catch(() => {});
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
  window.location.href = "login.html";
}

// ============================================================
// Текущая сессия
// ============================================================
export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

// ============================================================
// Текущий пользователь (полный профиль)
// ============================================================
export async function getCurrentProfile() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();
  if (error) throw error;
  return data;
}

// ============================================================
// Онлайн-статус
// ============================================================
export async function setOnlineStatus(isOnline) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase
    .from("profiles")
    .update({ is_online: isOnline, last_seen: new Date().toISOString() })
    .eq("id", user.id);
}

// ============================================================
// MFA (2FA TOTP)
// ============================================================
export async function listFactors() {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) throw error;
  return data;
}

export async function enrollTotp() {
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: "NEXORA TOTP " + Date.now(),
  });
  if (error) throw error;
  return data; // { id, type, totp: { qr_code, secret, uri } }
}

export async function verifyTotp(factorId, code) {
  const { data: challenge, error: chErr } = await supabase.auth.mfa.challenge({ factorId });
  if (chErr) throw chErr;
  const { data, error } = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challenge.id,
    code,
  });
  if (error) throw error;
  return data;
}

export async function unenrollFactor(factorId) {
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) throw error;
}

export async function getAuthenticatorAssuranceLevel() {
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) throw error;
  return data; // { currentLevel, nextLevel, currentAuthenticationMethods }
}

// ============================================================
// Смена пароля
// ============================================================
export async function changePassword(newPassword) {
  const err = validatePassword(newPassword);
  if (err) throw new Error(err);
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
}
