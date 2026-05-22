import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  Hash, Boxes, Cloud, Scale, Network, Send, Smile, Paperclip,
  LogOut, Users, Bell, Activity, Menu, X, Sun, Moon, MoreHorizontal, Trash2, EyeOff,
  Shield, Ban, VolumeX, Plus, Pencil, Pin, Flame,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getSession, clearSession, initials, formatTime, type Session } from "@/lib/session";
import { useTheme } from "@/hooks/use-theme";
import { GeneralFeed } from "@/components/GeneralFeed";
import { adminCall } from "@/lib/admin";
import { toast } from "sonner";
import { ConfirmDialog, type ConfirmOpts } from "@/components/ConfirmDialog";
import { BannedOverlay } from "@/components/BannedOverlay";

// Sort channels with #general always pinned on top.
const sortChannels = <T extends { id: string }>(cs: T[]): T[] =>
  [...cs].sort((a, b) => (a.id === "general" ? -1 : b.id === "general" ? 1 : 0));

const ADMIN_BAN_CHANNEL = "__admin_bans";
const ADMIN_CHANNELS_CHANNEL = "__admin_channels";

type MenuPos = { id: string; isMe: boolean; username: string; x: number; y: number; openUp: boolean };

export const Route = createFileRoute("/chat")({
  component: ChatPage,
  head: () => ({
    meta: [
      { title: "tt350 — Live Chat" },
      { name: "description", content: "Realtime academic chat — containers, cloud, conflictology, networks." },
    ],
  }),
});

type Message = {
  id: string;
  channel: string;
  username: string;
  avatar_color: string;
  content: string;
  created_at: string;
  media_url?: string | null;
  media_type?: string | null;
};

type Presence = {
  session_id: string;
  username: string;
  avatar_color: string;
  last_seen: string;
  joined_at: string;
};

type Channel = { id: string; name: string; description?: string | null; icon: any };

const CHANNEL_ICONS: Record<string, any> = {
  general: Hash, containers: Boxes, cloud: Cloud, conflict: Scale, networks: Network,
};

const FALLBACK_CHANNELS: Channel[] = [
  { id: "general",    name: "General",                              description: "Ընդհանուր քննարկում",        icon: Hash },
  { id: "containers", name: "Կոնտեյն. տեխնոլ. և միկրոծառ.",         description: "Containers & microservices", icon: Boxes },
  { id: "cloud",      name: "Ամպային տեխ. և համ.",                   description: "Cloud tech & computing",     icon: Cloud },
  { id: "conflict",   name: "Կոնֆլիկտաբանություն",                   description: "Conflictology",              icon: Scale },
  { id: "networks",   name: "Քոմփ. ցանցերի մոդելավորում",           description: "Computer network modeling",  icon: Network },
];

const EMOJIS = ["😀","😂","😍","🥳","🔥","💜","🚀","📚","🎓","💻","👀","✨","💯","😎","🤖","☁️","⚡","☕","📡","🎉"];

function showAdminError(message: string) {
  if (message.toLowerCase().includes("not configured")) {
    toast.error("Ban is not enabled in Supabase yet");
    return;
  }
  toast.error(message);
}

function ChatPage() {
  const navigate = useNavigate();
  const { theme, toggle } = useTheme();
  const [session, setSessionState] = useState<Session | null>(null);
  const [channel, setChannel] = useState("general");
  const [messages, setMessages] = useState<Message[]>([]);
  const [presence, setPresence] = useState<Presence[]>([]);
  const [draft, setDraft] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [recentJoins, setRecentJoins] = useState<{ name: string; color: string; at: number }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const raw = localStorage.getItem("tt350_hidden_msgs");
      return new Set(raw ? (JSON.parse(raw) as string[]) : []);
    } catch { return new Set(); }
  });
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());
  const [menuFor, setMenuFor] = useState<MenuPos | null>(null);
  const [channels, setChannels] = useState<Channel[]>(() => sortChannels(FALLBACK_CHANNELS));
  const [adminPanelOpen, setAdminPanelOpen] = useState(false);
  const [confirmOpts, setConfirmOpts] = useState<ConfirmOpts | null>(null);
  const [isBanned, setIsBanned] = useState(false);

  const askConfirm = useCallback((opts: ConfirmOpts) => setConfirmOpts(opts), []);
  const scrollRef = useRef<HTMLDivElement>(null);
  const wasNearBottomRef = useRef(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const kickBannedUser = useCallback(() => {
    if (!session || session.isAdmin) return;
    supabase.from("presence").delete().eq("session_id", session.sessionId);
    clearSession();
    navigate({ to: "/" });
  }, [navigate, session]);

  useEffect(() => {
    const s = getSession();
    if (!s) { navigate({ to: "/" }); return; }
    setSessionState(s);
  }, [navigate]);

  // Realtime ban watch — admins are never banned. If the current user gets banned,
  // an overlay blocks the UI immediately; when an admin removes the ban row,
  // the overlay disappears without a reload.
  useEffect(() => {
    if (!session || session.isAdmin) return;
    let mounted = true;
    const check = async () => {
      const [{ data: ban }, { data: fallbackBan }] = await Promise.all([
        supabase.from("bans").select("username").eq("username", session.username).maybeSingle(),
        supabase.from("messages").select("id").eq("channel", ADMIN_BAN_CHANNEL).eq("content", session.username).limit(1),
      ]);
      if (mounted && (ban || fallbackBan?.length)) kickBannedUser();
    };
    check();
    const ch = supabase.channel(`bans:${session.username}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "bans", filter: `username=eq.${session.username}` },
        (payload) => {
          if (!mounted) return;
          if (payload.eventType === "INSERT") kickBannedUser();
          else if (payload.eventType === "DELETE") setIsBanned(false);
        })
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `channel=eq.${ADMIN_BAN_CHANNEL}` },
        (payload) => {
          if ((payload.new as Message).content === session.username) kickBannedUser();
        })
      .subscribe();
    return () => { mounted = false; supabase.removeChannel(ch); };
  }, [kickBannedUser, session]);

  useEffect(() => {
    if (!session) return;
    let active = true;
    (async () => {
      const { data } = await supabase
        .from("messages").select("*").eq("channel", channel)
        .order("created_at", { ascending: true }).limit(200);
      if (active && data) setMessages(data as Message[]);
    })();
    const ch = supabase
      .channel(`messages:${channel}`)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `channel=eq.${channel}` },
        (payload) => {
          const msg = payload.new as Message;
          setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
        })
      .on("postgres_changes",
        { event: "DELETE", schema: "public", table: "messages" },
        (payload) => {
          const id = (payload.old as { id?: string })?.id;
          if (!id) return;
          setRemovingIds((s) => new Set(s).add(id));
          setTimeout(() => {
            setMessages((prev) => prev.filter((m) => m.id !== id));
            setRemovingIds((s) => { const n = new Set(s); n.delete(id); return n; });
          }, 280);
        })
      .subscribe();
    return () => { active = false; supabase.removeChannel(ch); };
  }, [session, channel]);

  const hideForMe = (id: string) => {
    setMenuFor(null);
    setRemovingIds((s) => new Set(s).add(id));
    setTimeout(() => {
      setHiddenIds((prev) => {
        const n = new Set(prev); n.add(id);
        try { localStorage.setItem("tt350_hidden_msgs", JSON.stringify([...n])); } catch {}
        return n;
      });
      setRemovingIds((s) => { const n = new Set(s); n.delete(id); return n; });
    }, 280);
  };

  const deleteForEveryone = async (id: string) => {
    setMenuFor(null);
    await supabase.from("messages").delete().eq("id", id);
  };

  // Admin: delete ANY message (privileged)
  const adminDeleteMessage = async (id: string) => {
    setMenuFor(null);
    try { await adminCall("delete_message", { id }); toast.success("Message deleted"); }
    catch (e: any) { toast.error("Delete failed: " + e.message); }
  };

  useEffect(() => {
    if (!session) return;
    const ch = supabase.channel("messages:all")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
        const m = payload.new as Message;
        if (m.channel === ADMIN_BAN_CHANNEL || m.channel === ADMIN_CHANNELS_CHANNEL) return;
        if (m.channel !== channel && m.username !== session.username) {
          setUnread((u) => ({ ...u, [m.channel]: (u[m.channel] || 0) + 1 }));
        }
      }).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [session, channel]);

  useEffect(() => { setUnread((u) => ({ ...u, [channel]: 0 })); }, [channel]);

  // Load + subscribe to dynamic channels list
  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const [{ data }, { data: channelEvents }] = await Promise.all([
        (supabase as any).from("channels").select("*").order("created_at", { ascending: true }),
        (supabase as any).from("messages").select("content, created_at").eq("channel", ADMIN_CHANNELS_CHANNEL).order("created_at", { ascending: true }),
      ]);
      if (!mounted) return;
      const mapped: Channel[] = ((data as any[]) ?? []).map((c: any) => ({
        id: c.id, name: c.name, description: c.description,
        icon: CHANNEL_ICONS[c.id] ?? Hash,
      }));
      const byId = new Map<string, Channel>();
      mapped.forEach((c) => byId.set(c.id, c));
      ((channelEvents as any[]) ?? []).forEach((row) => {
        try {
          const patch = JSON.parse(String(row.content ?? "{}"));
          const id = String(patch.id ?? "").trim();
          if (!id) return;
          if (patch.deleted) {
            byId.delete(id);
            return;
          }
          const existing = byId.get(id);
          byId.set(id, {
            id,
            name: String(patch.name ?? existing?.name ?? id),
            description: patch.description ?? existing?.description ?? null,
            icon: CHANNEL_ICONS[id] ?? Hash,
          });
        } catch {}
      });
      const next = sortChannels([...byId.values()]);
      setChannels(next.length ? next : sortChannels(FALLBACK_CHANNELS));
    };
    load();
    const ch = supabase.channel("channels:all")
      .on("postgres_changes", { event: "*", schema: "public", table: "channels" }, () => load())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `channel=eq.${ADMIN_CHANNELS_CHANNEL}` }, () => load())
      .subscribe();
    return () => { mounted = false; supabase.removeChannel(ch); };
  }, []);

  // Presence — STEALTH for admin: never broadcast, never appear online.
  useEffect(() => {
    if (!session) return;
    let mounted = true;
    const stealth = session.isAdmin;

    const upsert = async () => {
      if (stealth) return; // invisible admin
      await supabase.from("presence").upsert({
        session_id: session.sessionId, username: session.username,
        avatar_color: session.avatarColor, last_seen: new Date().toISOString(),
      });
    };
    upsert();
    const hb = setInterval(upsert, 5000);
    const loadPresence = async () => {
      const cutoff = new Date(Date.now() - 10000).toISOString();
      const { data } = await supabase.from("presence").select("*")
        .gte("last_seen", cutoff).order("joined_at", { ascending: false });
      if (mounted && data) setPresence(data as Presence[]);
    };
    loadPresence();
    const refresh = setInterval(loadPresence, 3000);
    const ch = supabase.channel("presence:all")
      .on("postgres_changes", { event: "*", schema: "public", table: "presence" }, (payload) => {
        if (payload.eventType === "INSERT") {
          const p = payload.new as Presence;
          if (p.session_id !== session.sessionId) {
            setRecentJoins((r) => [{ name: p.username, color: p.avatar_color, at: Date.now() }, ...r].slice(0, 5));
          }
        }
        loadPresence();
      }).subscribe();
    const leave = () => {
      if (!stealth) supabase.from("presence").delete().eq("session_id", session.sessionId);
    };
    window.addEventListener("beforeunload", leave);
    return () => {
      mounted = false; clearInterval(hb); clearInterval(refresh);
      supabase.removeChannel(ch); window.removeEventListener("beforeunload", leave);
      if (!stealth) supabase.from("presence").delete().eq("session_id", session.sessionId);
    };
  }, [session]);

  // Track whether the user was near the bottom BEFORE the messages update.
  // Reset when switching channels.
  useEffect(() => {
    wasNearBottomRef.current = true;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [channel]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
      wasNearBottomRef.current = dist < 120;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // AUTO-SCROLL — disabled completely for #general (Reddit/X-style feed).
  // For other channels: only scroll when the user was already near the bottom.
  useEffect(() => {
    if (channel === "general") return;
    const el = scrollRef.current;
    if (!el) return;
    if (!wasNearBottomRef.current) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, channel]);

  const sendMessage = async () => {
    if (!session) return;
    const content = draft.trim();
    if (!content) return;
    setDraft(""); setEmojiOpen(false);
    await supabase.from("messages").insert({
      channel, username: session.username,
      avatar_color: session.avatarColor, content,
    });
  };

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!session) return;
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const isImage = file.type.startsWith("image/");
    const isVideo = file.type.startsWith("video/");
    if (!isImage && !isVideo) {
      alert("Only photos and videos are supported.");
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      alert("Max file size is 25MB.");
      return;
    }
    setUploading(true);
    try {
      const ext = file.name.split(".").pop() || (isImage ? "jpg" : "mp4");
      const path = `${channel}/${session.sessionId}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("chat-media")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("chat-media").getPublicUrl(path);
      await supabase.from("messages").insert({
        channel,
        username: session.username,
        avatar_color: session.avatarColor,
        content: draft.trim() || (isImage ? "📷 photo" : "🎬 video"),
        media_url: pub.publicUrl,
        media_type: isImage ? "image" : "video",
      });
      setDraft("");
    } catch (err: any) {
      alert("Upload failed: " + (err?.message || "unknown"));
    } finally {
      setUploading(false);
    }
  };

  const onLogout = () => {
    if (session && !session.isAdmin) {
      supabase.from("presence").delete().eq("session_id", session.sessionId);
    }
    clearSession(); navigate({ to: "/" });
  };

  const currentChannel = useMemo(
    () => channels.find((c) => c.id === channel)
      ?? FALLBACK_CHANNELS.find((c) => c.id === channel)
      ?? { id: channel, name: channel, description: "", icon: Hash },
    [channels, channel]
  );
  const onlineCount = presence.length;
  const isAdmin = !!session?.isAdmin;

  if (!session) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="relative flex h-screen w-full overflow-hidden bg-background">
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 bg-foreground/30 backdrop-blur-sm md:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* LEFT SIDEBAR */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-border bg-card p-4 transition-transform md:relative md:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg gradient-primary">
              <Hash className="h-4 w-4 text-primary-foreground" />
            </div>
            <div>
              <div className="text-base font-semibold">tt350</div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{onlineCount} online</div>
            </div>
          </div>
          <button onClick={() => setSidebarOpen(false)} className="rounded-md p-1.5 hover:bg-muted md:hidden">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-5">
          <div className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Channels</div>
          <div className="space-y-0.5">
            {channels.map((c) => {
              const active = channel === c.id;
              const Icon = c.icon;
              const badge = unread[c.id] || 0;
              return (
                <button
                  key={c.id}
                  onClick={() => { setChannel(c.id); setSidebarOpen(false); }}
                  className={`group flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition ${
                    active
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <Icon className={`h-4 w-4 flex-shrink-0 ${active ? "text-primary" : ""}`} />
                  <span className="flex-1 text-left truncate">{c.name}</span>
                  {c.id === "general" && (
                    <Pin className="h-3 w-3 flex-shrink-0 text-amber-500/80 rotate-45" />
                  )}
                  {badge > 0 && (
                    <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
                      {badge > 9 ? "9+" : badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mb-2 flex items-center justify-between px-2">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Online — {onlineCount}
          </div>
          <Users className="h-3 w-3 text-muted-foreground" />
        </div>
        <div className="flex-1 space-y-0.5 overflow-y-auto scrollbar-thin pr-1">
          {presence.length === 0 && (
            <div className="px-2 py-4 text-center text-xs text-muted-foreground">Just you here…</div>
          )}
          {presence.map((p) => {
            const isMe = p.session_id === session.sessionId;
            return (
              <div key={p.session_id} className="flex items-center gap-2.5 rounded-md px-2 py-1.5 transition hover:bg-muted">
                <div className="relative">
                  <div
                    className="flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                    style={{ background: p.avatar_color }}
                  >
                    {initials(p.username)}
                  </div>
                  <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-online ring-2 ring-card" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">
                    {p.username} {isMe && <span className="text-xs text-muted-foreground">(you)</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-muted/40 p-2">
          <div
            className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold text-white"
            style={{ background: session.avatarColor }}
          >
            {initials(session.username)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium flex items-center gap-1.5">
              {session.username}
              {isAdmin && <Shield className="h-3 w-3 text-amber-500" aria-label="admin" />}
            </div>
            <div className={`text-[10px] ${isAdmin ? "text-amber-500" : "text-online"}`}>
              {isAdmin ? "● invisible (admin)" : "● online"}
            </div>
          </div>
          {isAdmin && (
            <button
              onClick={() => setAdminPanelOpen(true)}
              className="rounded-md p-1.5 text-amber-500 transition hover:bg-amber-500/10"
              title="Admin panel"
            >
              <Shield className="h-4 w-4" />
            </button>
          )}
          <button
            onClick={toggle}
            className="rounded-md p-1.5 text-muted-foreground transition hover:bg-background hover:text-foreground"
            title="Toggle theme"
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          <button onClick={onLogout} className="rounded-md p-1.5 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive" title="Leave">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </aside>

      {adminPanelOpen && session && (
        <AdminPanel
          channels={channels}
          currentChannel={channel}
          onlineCount={presence.length}
          onSwitchChannel={setChannel}
          onClose={() => setAdminPanelOpen(false)}
          askConfirm={askConfirm}
        />
      )}

      {/* CENTER */}
      <main className="relative flex flex-1 flex-col overflow-hidden">
        <header className="flex items-center gap-3 border-b border-border bg-card px-4 py-3">
          <button onClick={() => setSidebarOpen(true)} className="rounded-md p-1.5 hover:bg-muted md:hidden">
            <Menu className="h-5 w-5" />
          </button>
          <currentChannel.icon className="h-5 w-5 text-primary flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-semibold truncate">{currentChannel.name}</h1>
            <p className="text-xs text-muted-foreground truncate">{currentChannel.description}</p>
          </div>
          <div className="flex items-center gap-1.5 rounded-full bg-online/10 px-2.5 py-1 text-xs font-medium text-online">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-online" />
            LIVE
          </div>
        </header>

        <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-thin px-4 py-4 sm:px-6">
          {channel === "general" ? (
            <GeneralFeed session={session} />
          ) : (
            <>
          {messages.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-xl bg-accent">
                <currentChannel.icon className="h-7 w-7 text-primary" />
              </div>
              <h2 className="text-base font-semibold">{currentChannel.name}</h2>
              <p className="mt-1 text-sm text-muted-foreground">Be the first to drop a message.</p>
            </div>
          )}
          <div className="mx-auto max-w-3xl space-y-3">
            {messages.filter((m) => !hiddenIds.has(m.id)).map((m, i, arr) => {
              const prev = arr[i - 1];
              const grouped = prev && prev.username === m.username && new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < 5 * 60 * 1000;
              const isMe = m.username === session.username;
              const removing = removingIds.has(m.id);
              return (
                <div
                  key={m.id}
                  className={`group/msg flex gap-3 transition-all duration-300 ${
                    removing ? "opacity-0 -translate-y-1 scale-95" : "animate-message-in"
                  }`}
                >
                  <div className="w-9 flex-shrink-0">
                    {!grouped && (
                      <div
                        className="flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold text-white"
                        style={{ background: m.avatar_color }}
                      >
                        {initials(m.username)}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1 relative">
                    {!grouped && (
                      <div className="mb-0.5 flex items-baseline gap-2">
                        <span className="text-sm font-semibold text-foreground">{m.username}</span>
                        {isMe && <span className="text-[10px] uppercase tracking-wider text-primary">you</span>}
                        <span className="text-[10px] text-muted-foreground">{formatTime(m.created_at)}</span>
                      </div>
                    )}
                    <div className="flex items-start gap-1.5">
                    <div className={`inline-block max-w-full break-words rounded-xl px-3 py-2 text-sm leading-relaxed ${
                      isMe ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
                    }`}>
                      {m.media_url && m.media_type === "image" && (
                        <a href={m.media_url} target="_blank" rel="noreferrer" className="block">
                          <img
                            src={m.media_url}
                            alt="attachment"
                            className="mb-1 max-h-80 max-w-full rounded-lg object-cover"
                            loading="lazy"
                          />
                        </a>
                      )}
                      {m.media_url && m.media_type === "video" && (
                        <video
                          src={m.media_url}
                          controls
                          className="mb-1 max-h-80 max-w-full rounded-lg"
                        />
                      )}
                      {m.content && <div>{m.content}</div>}
                    </div>
                    <div className="opacity-0 group-hover/msg:opacity-100 transition">
                      <button
                        onClick={(e) => {
                          if (menuFor?.id === m.id) { setMenuFor(null); return; }
                          const r = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
                          const MENU_H = 220;
                          const MENU_W = 220;
                          const spaceBelow = window.innerHeight - r.bottom;
                          const openUp = spaceBelow < MENU_H + 12;
                          const x = Math.min(r.right - MENU_W, window.innerWidth - MENU_W - 8);
                          const y = openUp ? r.top - 6 : r.bottom + 6;
                          setMenuFor({ id: m.id, isMe, username: m.username, x: Math.max(8, x), y, openUp });
                        }}
                        className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                        title="More"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                    </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
            </>
          )}
        </div>


        {channel !== "general" && (
        <div className="relative border-t border-border bg-card p-3 sm:p-4">
          {emojiOpen && (
            <div className="absolute bottom-full left-3 mb-2 grid grid-cols-10 gap-1 rounded-lg border border-border bg-popover p-2 shadow-elegant">
              {EMOJIS.map((e) => (
                <button
                  key={e}
                  onClick={() => { setDraft((d) => d + e); inputRef.current?.focus(); }}
                  className="h-8 w-8 rounded-md text-lg transition hover:bg-muted"
                >
                  {e}
                </button>
              ))}
            </div>
          )}
          <div className="mx-auto flex max-w-3xl items-center gap-2 rounded-lg border border-border bg-input px-3 py-1.5 transition focus-within:focus-ring">
            <button onClick={() => setEmojiOpen((v) => !v)} className="rounded-md p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground" title="Emoji">
              <Smile className="h-5 w-5" />
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="rounded-md p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-50"
              title="Attach photo or video"
            >
              {uploading ? (
                <span className="block h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
              ) : (
                <Paperclip className="h-5 w-5" />
              )}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*,video/*"
              className="hidden"
              onChange={onPickFile}
            />
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
              placeholder={`Message ${currentChannel.name}`}
              maxLength={1000}
              className="flex-1 bg-transparent py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground/60"
            />
            <button
              onClick={sendMessage}
              disabled={!draft.trim()}
              className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
        )}
      </main>

      {/* RIGHT SIDEBAR */}
      <aside className="hidden w-72 flex-col gap-3 border-l border-border bg-card p-4 lg:flex">
        <Panel icon={Activity} title="Live activity">
          <div className="space-y-2 text-xs">
            <Stat label="Online now" value={onlineCount} />
            <Stat label="Messages" value={messages.length} />
            <Stat label="Channel" value={currentChannel.name} />
          </div>
        </Panel>

        <Panel icon={Bell} title="Recent joins">
          {recentJoins.length === 0 ? (
            <div className="text-xs text-muted-foreground">No recent joins yet.</div>
          ) : (
            <ul className="space-y-2">
              {recentJoins.map((j, i) => (
                <li key={i} className="flex items-center gap-2 text-xs">
                  <div className="h-6 w-6 rounded-full text-[9px] font-semibold text-white flex items-center justify-center"
                       style={{ background: j.color }}>
                    {initials(j.name)}
                  </div>
                  <span className="font-medium">{j.name}</span>
                  <span className="ml-auto text-muted-foreground">just now</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel icon={Users} title="Active now">
          <div className="flex flex-wrap gap-1.5">
            {presence.slice(0, 12).map((p) => (
              <div
                key={p.session_id}
                title={p.username}
                className="h-7 w-7 rounded-full text-[10px] font-semibold text-white flex items-center justify-center ring-2 ring-card"
                style={{ background: p.avatar_color }}
              >
                {initials(p.username)}
              </div>
            ))}
          </div>
        </Panel>
      </aside>

      {/* Floating message context menu — smart positioning, opens up if no space below */}
      {menuFor && (
        <>
          <div className="fixed inset-0 z-[70]" onClick={() => setMenuFor(null)} />
          <div
            className="fixed z-[71] w-[220px] overflow-hidden rounded-xl border border-border bg-popover/95 backdrop-blur-md shadow-elegant animate-scale-in"
            style={{
              left: menuFor.x,
              top: menuFor.openUp ? undefined : menuFor.y,
              bottom: menuFor.openUp ? window.innerHeight - menuFor.y : undefined,
              transformOrigin: menuFor.openUp ? "bottom right" : "top right",
            }}
          >
            <button
              onClick={() => hideForMe(menuFor.id)}
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-muted"
            >
              <EyeOff className="h-4 w-4" /> Delete for me
            </button>
            {menuFor.isMe && (
              <button
                onClick={() => deleteForEveryone(menuFor.id)}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="h-4 w-4" /> Delete for everyone
              </button>
            )}
            {isAdmin && !menuFor.isMe && (
              <>
                <button
                  onClick={() => adminDeleteMessage(menuFor.id)}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-amber-500 hover:bg-amber-500/10"
                >
                  <Shield className="h-4 w-4" /> Delete (admin)
                </button>
                <button
                  onClick={() => {
                    const u = menuFor.username; setMenuFor(null);
                    askConfirm({
                      title: `Ban @${u}?`,
                      description: "This user will no longer be able to send messages or posts.",
                      confirmLabel: "Ban user",
                      onConfirm: async () => {
                        try { await adminCall("ban_user", { username: u }); toast.success(`Banned ${u}`); }
                        catch (e: any) { showAdminError(e.message); }
                      },
                    });
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-rose-500 hover:bg-rose-500/10"
                >
                  <Ban className="h-4 w-4" /> Ban {menuFor.username}
                </button>
                <button
                  onClick={() => {
                    const u = menuFor.username; setMenuFor(null);
                    adminCall("mute_user", { username: u, minutes: 60 })
                      .then(() => toast.success(`Muted ${u} for 60m`))
                      .catch((e) => toast.error(e.message));
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-sky-500 hover:bg-sky-500/10"
                >
                  <VolumeX className="h-4 w-4" /> Mute 60m
                </button>
              </>
            )}
          </div>
        </>
      )}

      <ConfirmDialog open={!!confirmOpts} opts={confirmOpts} onClose={() => setConfirmOpts(null)} />
      {isBanned && <BannedOverlay username={session.username} onLogout={onLogout} />}
    </div>
  );
}

function Panel({ icon: Icon, title, children }: { icon: any; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <div className="mb-2 flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground truncate">{label}</span>
      <span className="font-medium text-foreground truncate">{value}</span>
    </div>
  );
}

// ============================================================
// Admin Panel — visible only when admin mode is active
// ============================================================
function AdminPanel({
  channels, currentChannel, onlineCount, onSwitchChannel, onClose, askConfirm,
}: {
  channels: Channel[];
  currentChannel: string;
  onlineCount: number;
  onSwitchChannel: (id: string) => void;
  onClose: () => void;
  askConfirm: (opts: ConfirmOpts) => void;
}) {
  const [bans, setBans] = useState<{ username: string; reason: string | null }[]>([]);
  const [mutes, setMutes] = useState<{ username: string; until: string | null }[]>([]);
  const [msgCount, setMsgCount] = useState<number | null>(null);
  const [newChanId, setNewChanId] = useState("");
  const [newChanName, setNewChanName] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    const [{ data: b }, { data: fallbackBans }, { data: m }, { count }] = await Promise.all([
      (supabase as any).from("bans").select("username, reason").order("created_at", { ascending: false }),
      (supabase as any).from("messages").select("content").eq("channel", ADMIN_BAN_CHANNEL).order("created_at", { ascending: false }),
      (supabase as any).from("mutes").select("username, until").order("created_at", { ascending: false }),
      (supabase as any)
        .from("messages")
        .select("id", { count: "exact", head: true })
        .neq("channel", ADMIN_BAN_CHANNEL)
        .neq("channel", ADMIN_CHANNELS_CHANNEL),
    ]);
    const merged = new Map<string, { username: string; reason: string | null }>();
    ((fallbackBans as any[]) ?? []).forEach((row) => {
      if (row.content) merged.set(row.content, { username: row.content, reason: null });
    });
    ((b as any[]) ?? []).forEach((row) => {
      merged.set(row.username, { username: row.username, reason: row.reason ?? null });
    });
    setBans([...merged.values()]);
    setMutes((m as any) ?? []);
    setMsgCount(typeof count === "number" ? count : null);
  };
  useEffect(() => {
    refresh();
    const ch = supabase.channel("admin:watch")
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, () => refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "bans" }, () => refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "mutes" }, () => refresh())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); await refresh(); toast.success("Done"); }
    catch (e: any) { toast.error("Admin error: " + e.message); }
    finally { setBusy(false); }
  };

  const sortedChannels = sortChannels(channels);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-foreground/50 backdrop-blur-md p-4 animate-fade-in" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl max-h-[88vh] overflow-y-auto rounded-2xl border border-border bg-card/95 backdrop-blur-xl shadow-elegant animate-scale-in"
      >
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card/95 backdrop-blur-xl px-5 py-3">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-amber-500" />
            <h2 className="text-sm font-semibold">Admin panel <span className="ml-2 text-[10px] uppercase tracking-wider text-amber-500">stealth</span></h2>
          </div>
          <button onClick={onClose} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="space-y-5 p-5">
          {/* Stats */}
          <section className="grid grid-cols-3 gap-2">
            <div className="rounded-lg border border-border bg-background/60 p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Online</div>
              <div className="mt-0.5 text-xl font-semibold text-online">{onlineCount}</div>
            </div>
            <div className="rounded-lg border border-border bg-background/60 p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Messages</div>
              <div className="mt-0.5 text-xl font-semibold">{msgCount ?? "—"}</div>
            </div>
            <div className="rounded-lg border border-border bg-background/60 p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Banned</div>
              <div className="mt-0.5 text-xl font-semibold text-rose-500">{bans.length}</div>
            </div>
          </section>

          {/* Danger zone — mass delete */}
          <section className="rounded-xl border border-destructive/30 bg-destructive/5 p-3">
            <div className="mb-2 flex items-center gap-2">
              <Flame className="h-4 w-4 text-destructive" />
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-destructive">Danger zone</h3>
            </div>
            <p className="mb-3 text-xs text-muted-foreground">
              Wipes every message, post, comment, reaction and presence. Channels, bans and mutes are preserved.
            </p>
            <button
              disabled={busy}
              onClick={() => askConfirm({
                title: "Wipe ALL messages?",
                description: `This will permanently delete:\n• ${msgCount ?? "?"} chat messages & posts\n• all comments & reactions\n• all online presence\n\nThis cannot be undone.`,
                confirmLabel: "Wipe everything",
                onConfirm: () => run(() => adminCall("wipe_all")),
              })}
              className="flex items-center gap-2 rounded-md bg-destructive px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:opacity-90 disabled:opacity-40"
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete all messages
            </button>
          </section>

          {/* Channels */}
          <section>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Channels ({sortedChannels.length})</h3>
            <div className="space-y-1.5">
              {sortedChannels.map((c) => (
                <div key={c.id} className="flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5">
                  <Hash className="h-3.5 w-3.5 text-muted-foreground" />
                  {c.id === "general" && <Pin className="h-3 w-3 rotate-45 text-amber-500" />}
                  {renaming === c.id ? (
                    <>
                      <input
                        autoFocus value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        className="flex-1 rounded-md border border-border bg-input px-2 py-1 text-sm outline-none"
                      />
                      <button
                        disabled={busy}
                        onClick={() => run(async () => {
                          await adminCall("rename_channel", { id: c.id, name: renameValue.trim() });
                          setRenaming(null);
                        })}
                        className="rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground"
                      >Save</button>
                      <button onClick={() => setRenaming(null)} className="rounded-md px-2 py-1 text-xs">Cancel</button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => onSwitchChannel(c.id)} className="flex-1 truncate text-left text-sm hover:underline">
                        {c.name} <span className="text-xs text-muted-foreground">#{c.id}</span>
                        {currentChannel === c.id && <span className="ml-1 text-[10px] uppercase text-primary">live</span>}
                      </button>
                      <button
                        onClick={() => { setRenaming(c.id); setRenameValue(c.name); }}
                        className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground" title="Rename"
                      ><Pencil className="h-3.5 w-3.5" /></button>
                      {c.id !== "general" && (
                        <button
                          disabled={busy}
                          onClick={() => askConfirm({
                            title: `Delete channel #${c.id}?`,
                            description: "All messages in this channel will be permanently deleted.",
                            confirmLabel: "Delete channel",
                            onConfirm: () => run(() => adminCall("delete_channel", { id: c.id })),
                          })}
                          className="rounded-md p-1 text-destructive hover:bg-destructive/10" title="Delete"
                        ><Trash2 className="h-3.5 w-3.5" /></button>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              <input
                value={newChanId}
                onChange={(e) => setNewChanId(e.target.value)}
                placeholder="id (slug)"
                className="w-32 rounded-md border border-border bg-input px-2 py-1.5 text-sm outline-none"
              />
              <input
                value={newChanName}
                onChange={(e) => setNewChanName(e.target.value)}
                placeholder="name"
                className="flex-1 rounded-md border border-border bg-input px-2 py-1.5 text-sm outline-none"
              />
              <button
                disabled={busy || !newChanId.trim() || !newChanName.trim()}
                onClick={() => run(async () => {
                  await adminCall("create_channel", { id: newChanId.trim(), name: newChanName.trim() });
                  setNewChanId(""); setNewChanName("");
                })}
                className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-40"
              ><Plus className="h-3.5 w-3.5" /> Add</button>
            </div>
          </section>

          {/* Bans */}
          <section>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Bans ({bans.length})</h3>
            {bans.length === 0 ? (
              <div className="text-xs text-muted-foreground">No bans.</div>
            ) : (
              <div className="space-y-1">
                {bans.map((b) => (
                  <div key={b.username} className="flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm">
                    <Ban className="h-3.5 w-3.5 text-rose-500" />
                    <span className="flex-1 truncate">{b.username}</span>
                    <button
                      disabled={busy}
                      onClick={() => run(() => adminCall("unban_user", { username: b.username }))}
                      className="rounded-md px-2 py-0.5 text-xs hover:bg-muted"
                    >Unban</button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Mutes */}
          <section>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Mutes ({mutes.length})</h3>
            {mutes.length === 0 ? (
              <div className="text-xs text-muted-foreground">No mutes.</div>
            ) : (
              <div className="space-y-1">
                {mutes.map((m) => (
                  <div key={m.username} className="flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm">
                    <VolumeX className="h-3.5 w-3.5 text-sky-500" />
                    <span className="flex-1 truncate">
                      {m.username} {m.until && <span className="text-xs text-muted-foreground">until {new Date(m.until).toLocaleString()}</span>}
                    </span>
                    <button
                      disabled={busy}
                      onClick={() => run(() => adminCall("unmute_user", { username: m.username }))}
                      className="rounded-md px-2 py-0.5 text-xs hover:bg-muted"
                    >Unmute</button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <p className="text-[11px] text-muted-foreground">
            All actions execute server-side with the service role. Realtime sync is active — changes appear instantly for every client.
          </p>
        </div>
      </div>
    </div>
  );
}
