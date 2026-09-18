import { supabase } from "./supabase.js";
import { toast, applyTheme } from "./utils.js";
import { updateProfile } from "./profile.js";

export function initAppearanceSettings() {
  const current = localStorage.getItem("nexora-theme") || "dark";
  document.querySelectorAll("[data-theme-choice]").forEach(btn => {
    if (btn.dataset.themeChoice === current) btn.classList.add("active");
    btn.addEventListener("click", () => {
      const t = btn.dataset.themeChoice;
      applyTheme(t);
      document.querySelectorAll("[data-theme-choice]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      toast(`Theme: ${t}`, "success");
    });
  });
}

export async function initPrivacySettings(profile) {
  const findable = document.getElementById("privacy-findable");
  const allow = document.getElementById("privacy-allow-messages");
  const showOnline = document.getElementById("privacy-show-online");

  if (findable) {
    findable.classList.toggle("on", profile.findable);
    findable.addEventListener("click", async () => {
      const next = !findable.classList.contains("on");
      findable.classList.toggle("on", next);
      try {
        await updateProfile({ findable: next });
        toast("Privacy updated", "success");
      } catch (e) {
        findable.classList.toggle("on", !next);
        toast(e.message, "error");
      }
    });
  }

  if (allow) {
    allow.value = profile.allow_messages || "everyone";
    allow.addEventListener("change", async () => {
      try {
        await updateProfile({ allow_messages: allow.value });
        toast("Privacy updated", "success");
      } catch (e) { toast(e.message, "error"); }
    });
  }

  if (showOnline) {
    showOnline.classList.toggle("on", profile.show_online);
    showOnline.addEventListener("click", async () => {
      const next = !showOnline.classList.contains("on");
      showOnline.classList.toggle("on", next);
      try {
        await updateProfile({ show_online: next });
        toast("Privacy updated", "success");
      } catch (e) {
        showOnline.classList.toggle("on", !next);
        toast(e.message, "error");
      }
    });
  }
}

export async function updateEmail(newEmail) {
  const { error } = await supabase.auth.updateUser({ email: newEmail });
  if (error) throw error;
}
