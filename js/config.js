/**
 * GitHub Pages 會直接提供這個檔案，因此只能放公開設定。
 * 請勿放入密碼、service_role key 或資料庫密碼。
 */
export const SUPABASE_URL = "https://agydjgerahlknbttcopz.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_ckdiDrxPZG4gBv-6Hab49A_oMfXaNFt";

// 白板只顯示簡單帳號；Supabase Auth 底層仍使用 Email/Password。
// 這兩個值不是秘密，實際安全性由密碼、session、角色與 RLS 保護。
export const KIOSK_LOGIN_USERNAME = "user";
export const KIOSK_AUTH_EMAIL = "user@toothbrushing-record.invalid";
