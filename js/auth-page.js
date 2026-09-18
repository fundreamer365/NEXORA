// Используется на login.html и register.html
import { supabase } from "./supabase.js";
import { initTheme, toast, validateUsername } from "./utils.js";
import {
  register, login, getSession, getAuthenticatorAssuranceLevel,
  listFactors, verifyTotp
} from "./auth.js";

initTheme();

document.addEventListener("DOMContentLoaded", () => {
  const loginForm = document.getElementById("login-form");
  const registerForm = document.getElementById("register-form");
  const mfaForm = document.getElementById("mfa-form");

  if (loginForm) initLogin();
  if (registerForm) initRegister();
  if (mfaForm) initMfa();
});

async function initLogin() {
  // Если ?mfa=1 — показать форму MFA
  const params = new URLSearchParams(window.location.search);
  if (params.get("mfa") === "1") {
    const session = await getSession();
    if (!session) { window.location.href = "login.html"; return; }
    const levels = await getAuthenticatorAssuranceLevel();
    if (levels.currentLevel === "aal2") {
      window.location.href = "app.html";
      return;
    }
    showMfaForm();
    return;
  }

  // Уже залогинен?
  const session = await getSession();
  if (session) {
    const levels = await getAuthenticatorAssuranceLevel();
    if (levels.nextLevel === "aal2" && levels.currentLevel === "aal1") {
      window.location.href = "login.html?mfa=1";
      return;
    }
    window.location.href = "app.html";
    return;
  }

  const form = document.getElementById("login-form");
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const email = form.email.value.trim();
    const password = form.password.value;
    const errEl = document.getElementById("auth-error");
    const btn = form.querySelector("button[type=submit]");
    errEl.classList.remove("show");
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    try {
      await login(email, password);
      const levels = await getAuthenticatorAssuranceLevel();
      if (levels.nextLevel === "aal2" && levels.currentLevel === "aal1") {
        window.location.href = "login.html?mfa=1";
        return;
      }
      toast("Welcome back!", "success");
      window.location.href = "app.html";
    } catch (err) {
      errEl.textContent = err.message || "Login failed";
      errEl.classList.add("show");
    } finally {
      btn.disabled = false;
      btn.textContent = "Sign in";
    }
  });
}

async function showMfaForm() {
  document.getElementById("login-card").classList.add("hidden");
  const wrap = document.getElementById("mfa-card");
  wrap.classList.remove("hidden");

  const form = document.getElementById("mfa-form");
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const code = form.code.value.trim();
    const errEl = document.getElementById("mfa-error");
    const btn = form.querySelector("button[type=submit]");
    errEl.classList.remove("show");
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';
    try {
      const { data } = await supabase.auth.mfa.listFactors();
      const totp = (data.totp || [])[0];
      if (!totp) throw new Error("No TOTP factor found");
      const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({ factorId: totp.id });
      if (chErr) throw chErr;
      const { error } = await supabase.auth.mfa.verify({
        factorId: totp.id,
        challengeId: ch.id,
        code,
      });
      if (error) throw error;
      toast("Verified", "success");
      window.location.href = "app.html";
    } catch (err) {
      errEl.textContent = err.message || "Invalid code";
      errEl.classList.add("show");
      btn.disabled = false;
      btn.textContent = "Verify";
    }
  });
}

async function initMfa() {
  const session = await getSession();
  if (!session) { window.location.href = "login.html"; return; }
  showMfaForm();
}

function initRegister() {
  const form = document.getElementById("register-form");
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const username = form.username.value.trim();
    const email = form.email.value.trim();
    const password = form.password.value;
    const password2 = form.password2.value;
    const errEl = document.getElementById("auth-error");
    const btn = form.querySelector("button[type=submit]");
    errEl.classList.remove("show");

    const uErr = validateUsername(username);
    if (uErr) { errEl.textContent = uErr; errEl.classList.add("show"); return; }
    if (password !== password2) {
      errEl.textContent = "Passwords do not match";
      errEl.classList.add("show");
      return;
    }

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';
    try {
      await register(email, password, username);
      toast("Account created. Check your email to confirm.", "success");
      setTimeout(() => window.location.href = "login.html", 1500);
    } catch (err) {
      errEl.textContent = err.message || "Registration failed";
      errEl.classList.add("show");
    } finally {
      btn.disabled = false;
      btn.textContent = "Create account";
    }
  });
}
