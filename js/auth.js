import { requireClient } from "./supabase.js";
import { KIOSK_AUTH_EMAIL, KIOSK_LOGIN_USERNAME } from "./config.js";

export async function getSignedInAppUser(client) {
  const supabase = requireClient(client);
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;

  const user = sessionData.session?.user;
  if (!user) return null;

  const { data: appUser, error: roleError } = await supabase
    .from("app_users")
    .select("user_id, role, display_name, is_active")
    .eq("user_id", user.id)
    .maybeSingle();

  if (roleError) throw roleError;
  if (!appUser?.is_active) return null;

  return { authUser: user, ...appUser };
}

export async function signInForRole(client, email, password, requiredRole) {
  const supabase = requireClient(client);
  const { error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  });
  if (error) throw error;

  const appUser = await getSignedInAppUser(supabase);
  if (!appUser || appUser.role !== requiredRole) {
    await supabase.auth.signOut();
    const roleError = new Error("帳號沒有此頁面的使用權限。");
    roleError.code = "WRONG_APP_ROLE";
    throw roleError;
  }

  return appUser;
}

export async function signInKiosk(client, username, password) {
  const normalizedUsername = username.trim().toLowerCase();
  if (normalizedUsername !== KIOSK_LOGIN_USERNAME.toLowerCase()) {
    const loginError = new Error("裝置帳號錯誤。");
    loginError.code = "INVALID_KIOSK_USERNAME";
    throw loginError;
  }

  return signInForRole(client, KIOSK_AUTH_EMAIL, password, "kiosk");
}

export async function signOut(client) {
  const supabase = requireClient(client);
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function requireAppRole(client, requiredRole) {
  const appUser = await getSignedInAppUser(client);
  return appUser?.role === requiredRole ? appUser : null;
}
