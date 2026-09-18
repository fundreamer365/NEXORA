// Значения по умолчанию — заменяются через config.js после клонирования.
// Файл создаётся вручную на основе config.example.js.
import { SUPABASE_URL as _U, SUPABASE_ANON_KEY as _K } from "../config.js";

export const SUPABASE_URL = _U;
export const SUPABASE_ANON_KEY = _K;

export const APP_NAME = "NEXORA";
export const APP_TAGLINE = "Connect without limits.";
export const MAX_MESSAGE_LENGTH = 4000;
