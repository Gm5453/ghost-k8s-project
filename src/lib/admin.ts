// Client helper for the privileged admin endpoint.
// Backed by a TanStack server route at /api/public/admin-ops that uses
// supabaseAdmin server-side (bypasses RLS). The shared passcode lives in
// sessionStorage and is sent as `x-admin-pass`.

const PASS_KEY = "tt350_admin_pass";
const USER_KEY = "tt350_user";
export const ADMIN_TRIGGER = "gm456";
export const WIPE_TRIGGER = "200105";

export function setAdminPass(pass: string) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(PASS_KEY, pass);
}
export function getAdminPass(): string | null {
  if (typeof window === "undefined") return null;
  const stored = sessionStorage.getItem(PASS_KEY);
  if (stored) return stored;
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    const user = JSON.parse(raw) as { username?: string };
    const username = user.username?.trim() ?? "";
    if (username.toLowerCase() !== ADMIN_TRIGGER) return null;
    setAdminPass(username);
    return username;
  } catch {
    return null;
  }
}
export function clearAdminPass() {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(PASS_KEY);
}

export async function adminCall(action: string, payload: Record<string, unknown> = {}) {
  const pass = getAdminPass();
  if (!pass) throw new Error("Not authorized (admin pass missing)");
  let res: Response;
  try {
    res = await fetch("/api/public/admin-ops", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-pass": pass },
      body: JSON.stringify({ action, ...payload }),
    });
  } catch (e: any) {
    console.error("[adminCall] network error", action, e);
    throw new Error("Network error — check your connection");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error ?? `Request failed (${res.status})`;
    console.error("[adminCall] failed", action, msg);
    throw new Error(msg);
  }
  return data;
}
