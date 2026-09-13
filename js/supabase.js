import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./config.js";

const urlLooksValid = /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(SUPABASE_URL);
const keyLooksValid =
  typeof SUPABASE_PUBLISHABLE_KEY === "string" &&
  SUPABASE_PUBLISHABLE_KEY.length > 20 &&
  !SUPABASE_PUBLISHABLE_KEY.includes("YOUR_");

export const isSupabaseConfigured = urlLooksValid && keyLooksValid;

const sharedOptions = {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
};

function makeClient(storageKey) {
  if (!isSupabaseConfigured) return null;

  return createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    ...sharedOptions,
    auth: { ...sharedOptions.auth, storageKey },
  });
}

// 分開保存 session，避免同一瀏覽器中的 kiosk 與 teacher 互相登出。
export const kioskClient = makeClient("toothbrushing-kiosk-auth-v1");
export const teacherClient = makeClient("toothbrushing-teacher-auth-v1");

export function requireClient(client) {
  if (!client) {
    const error = new Error("Supabase 尚未完成設定。");
    error.code = "SUPABASE_NOT_CONFIGURED";
    throw error;
  }
  return client;
}

