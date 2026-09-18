// Реэкспорт корневого config.js. Все модули js/ импортируют отсюда.
import {
  SUPABASE_URL as _URL,
  SUPABASE_ANON_KEY as _KEY,
} from "../config.js";

export const SUPABASE_URL = _URL;
export const SUPABASE_ANON_KEY = _KEY;

export const APP_NAME = "NEXORA";
export const APP_TAGLINE = "Connect without limits.";
export const MAX_MESSAGE_LENGTH = 4000;
