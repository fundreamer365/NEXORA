// Используется на login.html и register.html
import { supabase } from "./supabase.js";
import { initTheme, toast, validateUsername } from "./utils.js";
import { register, login } from "./auth.js";

initTheme();

document.addEventListener("DOMContentLoaded", () => {
  const loginForm = document.getElementById("login-form");
  const registerForm = document.getElementById("register-form");
  const mfaForm = document.getElementById("mfa-form");

  if (loginForm) initLogin();
  if (registerForm) initRegister();
  if (mfaForm) initMfa();
});

// ============================================================
// LOGIN
// ============================================================
function initLogin() {
  const params = new URLSearchParams(window.location.search);
  const mfaRequired = params.get("mfa") === "1";

  const loginCard = document.getElementById("login-card");
  const mfaCard = document.getElementById("mfa-card");

  // Показываем правильную карточку
  if (mfaRequired) {
    loginCard.classList.add("hidden");
    mfaCard.classList.remove("hidden");
  } else {
    loginCard.classList.remove("hidden");
    mfaCard.classList.add("hidden");
  }

  const form = document.getElementById("login-form");
  form.addEventListener("submit", async (e) => {
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

      // Проверяем, нужен ли MFA-челлендж
      const { data: aal, error: aalErr } =
        await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aalErr) throw aalErr;

      if (aal.nextLevel === "aal2" && aal.currentLevel === "aal1") {
        window.location.href = "login.html?mfa=1";
        return;
      }

      toast("Welcome back!", "success");
      window.location.href = "app.html";
    } catch (err) {
      errEl.textContent = err.message || "Login failed";
      errEl.classList.add("show");
      btn.disabled = false;
      btn.textContent = "Sign in";
    }
  });
}

// ============================================================
// MFA
// ============================================================
async function initMfa() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("mfa") !== "1") {
    return; // форма скрыта, ничего не делаем
  }

  const loginCard = document.getElementById("login-card");
  const mfaCard = document.getElementById("mfa-card");
  loginCard.classList.add("hidden");
  mfaCard.classList.remove("hidden");

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    window.location.href = "login.html";
    return;
  }

  // Если уже aal2 — сразу в приложение
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal && aal.currentLevel === "aal2") {
    window.location.href = "app.html";
    return;
  }

  const form = document.getElementById("mfa-form");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const code = form.code.value.trim();
    const errEl = document.getElementById("mfa-error");
    const btn = form.querySelector("button[type=submit]");
    errEl.classList.remove("show");
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    try {
      const { data: factorsData, error: fErr } =
        await supabase.auth.mfa.listFactors();
      if (fErr) throw fErr;
      const totp = (factorsData.totp || [])[0];
      if (!totp) throw new Error("No TOTP factor found");

      const { data: challenge, error: chErr } =
        await supabase.auth.mfa.challenge({ factorId: totp.id });
      if (chErr) throw chErr;

      const { error } = await supabase.auth.mfa.verify({
        factorId: totp.id,
        challengeId: challenge.id,
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

// ============================================================
// REGISTER
// ============================================================
function initRegister() {
  const form = document.getElementById("register-form");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = form.username.value.trim();
    const email = form.email.value.trim();
    const password = form.password.value;
    const password2 = form.password2.value;
    const errEl = document.getElementById("auth-error");
    const btn = form.querySelector("button[type=submit]");
    errEl.classList.remove("show");

    const uErr = validateUsername(username);
    if (uErr) {
      errEl.textContent = uErr;
      errEl.classList.add("show");
      return;
    }
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
      setTimeout(() => (window.location.href = "login.html"), 1500);
    } catch (err) {
      errEl.textContent = err.message || "Registration failed";
      errEl.classList.add("show");
      btn.disabled = false;
      btn.textContent = "Create account";
    }
  });
}
