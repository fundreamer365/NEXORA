import { supabase } from "./supabase.js";
import {
  listFactors,
  enrollTotp,
  verifyTotp,
  unenrollFactor,
  getAuthenticatorAssuranceLevel,
  changePassword,
} from "./auth.js";

export {
  listFactors,
  enrollTotp,
  verifyTotp,
  unenrollFactor,
  getAuthenticatorAssuranceLevel,
  changePassword,
};

export async function requiresMfaChallenge() {
  const levels = await getAuthenticatorAssuranceLevel();
  return levels.currentLevel === "aal1" && levels.nextLevel === "aal2";
}

export async function listActiveSessionInfo() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  return {
    expires_at: session.expires_at,
    created_at: session.user.created_at,
    last_sign_in_at: session.user.last_sign_in_at,
    provider: (session.user.app_metadata && session.user.app_metadata.provider) || "email",
  };
}
