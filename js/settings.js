import { supabase } from "./supabase.js";
import { toast, applyTheme } from "./utils.js";
import { updateProfile } from "./profile.js";

export function initAppearanceSettings() {
  const current = localStorage.getItem("nexora-theme") || "dark";
  document.querySelectorAll("[data-theme-choice]").forEach((btn) => {
    if (btn.dataset.themeChoice === current) btn.classList.add("active");
    btn.addEventListener("click", () => {
      const t = btn.dataset.themeChoice;
      applyTheme(t);
      document
        .querySelectorAll("[data-theme-choice]")
        .forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      toast(`Theme: ${t}`, "success");
    });
  });
}

export async function updateEmail(newEmail) {
  const { error } = await supabase.auth.updateUser({ email: newEmail });
  if (error) throw error;
}
