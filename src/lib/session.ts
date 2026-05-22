const USER_KEY = "tt350_user";
const SESSION_KEY = "tt350_session";

const COLORS = [
  "#6366f1", "#0ea5e9", "#14b8a6", "#22c55e",
  "#eab308", "#f97316", "#ef4444", "#ec4899",
  "#8b5cf6", "#64748b",
];

import { ADMIN_TRIGGER, setAdminPass, clearAdminPass } from "./admin";

export type Session = {
  username: string;
  avatarColor: string;
  sessionId: string;
  isAdmin: boolean;
};

export function pickColor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
}

function isAdminName(name: string) {
  return name.trim().toLowerCase() === ADMIN_TRIGGER;
}

export function getSession(): Session | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    const u = JSON.parse(raw) as { username: string; avatarColor: string };
    let sid = sessionStorage.getItem(SESSION_KEY);
    if (!sid) {
      sid = crypto.randomUUID();
      sessionStorage.setItem(SESSION_KEY, sid);
    }
    const admin = isAdminName(u.username);
    if (admin) setAdminPass(u.username.trim()); else clearAdminPass();
    return { ...u, sessionId: sid, isAdmin: admin };
  } catch {
    return null;
  }
}

export function setSession(username: string): Session {
  const avatarColor = pickColor(username);
  localStorage.setItem(USER_KEY, JSON.stringify({ username, avatarColor }));
  let sid = sessionStorage.getItem(SESSION_KEY);
  if (!sid) {
    sid = crypto.randomUUID();
    sessionStorage.setItem(SESSION_KEY, sid);
  }
  const admin = isAdminName(username);
  if (admin) setAdminPass(username.trim()); else clearAdminPass();
  return { username, avatarColor, sessionId: sid, isAdmin: admin };
}

export function clearSession() {
  localStorage.removeItem(USER_KEY);
  sessionStorage.removeItem(SESSION_KEY);
  clearAdminPass();
}

export function initials(name: string) {
  return name.trim().split(/\s+/).map(p => p[0]).join("").slice(0, 2).toUpperCase();
}

export function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
