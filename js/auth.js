import { supabase } from "./supabase.js";
import { validateUsername, validatePassword } from "./utils.js";

// ============================================================
// Внутренний "виртуальный" email. Наружу не показывается.
// Пользователь думает, что логинится по username.
// ============================================================
const VIRTUAL_DOMAIN = "nexora.local";

function usernameToEmail(username) {
  return username.toLowerCase().trim() + "@" + VIRTUAL_DOMAIN;
}

// ============================================================
// Регистрация (username + password)
// ============================================================
export async function register(username, password) {
  const uErr = validateUsername(username);
  if (uErr) throw new Error(uErr);
  const pErr = validatePassword(password);
  if (pErr) throw new Error(pErr);

  const email = usernameToEmail(username);

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { username: username.toLowerCase().trim() },
    },
  });
  if (error) throw error;

  if (data.user && data.user.identities && data.user.identities.length === 0) {
    throw new Error("This username is already taken");
  }
  return data;
}

// ============================================================
// Вход (username + password)
// ============================================================
export async function login(username, password) {
  const uErr = validateUsername(username);
  if (uErr) throw new Error(uErr);
  if (!password) throw new Error("Password is required");

  const email = usernameToEmail(username);

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    // Supabase возвращает "Invalid login credentials" — переведём на человеческий
    if (/invalid login/i.test(error.message)) {
      throw new Error("Wrong username or password");
    }
    throw error;
  }
  return data;
}

// ============================================================
// Выход
// ============================================================
export async function logout() {
  try { await setOnlineStatus(false); } catch (_) {}
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
  window.location.href = "login.html";
}

// ============================================================
// Сессия
// ============================================================
export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

// ============================================================
// Текущий профиль
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
// MFA
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
  return data;
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
  return data;
}

export async function changePassword(newPassword) {
  const err = validatePassword(newPassword);
  if (err) throw new Error(err);
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
}
