import { useEffect, useMemo, useRef, useState } from "react";
import {
  Heart, ThumbsDown, MessageCircle, Share2, MoreHorizontal,
  Send, Image as ImageIcon, Trash2, EyeOff, X, Shield, Ban, VolumeX,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { initials, type Session } from "@/lib/session";
import { adminCall } from "@/lib/admin";
import { toast } from "sonner";

type Post = {
  id: string;
  channel: string;
  username: string;
  avatar_color: string;
  content: string;
  created_at: string;
  media_url?: string | null;
  media_type?: string | null;
};

type Reaction = { id: string; post_id: string; session_id: string; username: string; type: "like" | "dislike" };
type Comment = { id: string; post_id: string; username: string; avatar_color: string; content: string; created_at: string };

const HIDDEN_KEY = "tt350_hidden_posts";
function loadHidden(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) || "[]")); } catch { return new Set(); }
}
function saveHidden(s: Set<string>) {
  localStorage.setItem(HIDDEN_KEY, JSON.stringify([...s]));
}

function timeAgo(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return `${Math.max(1, Math.floor(diff))}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

function showAdminError(message: string) {
  if (message.toLowerCase().includes("not configured")) {
    toast.error("Ban is not enabled in Supabase yet");
    return;
  }
  toast.error(message);
}

export function GeneralFeed({ session }: { session: Session }) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [commentsCount, setCommentsCount] = useState<Record<string, number>>({});
  const [hidden, setHidden] = useState<Set<string>>(() => loadHidden());
  const [removing, setRemoving] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState("");
  const [uploading, setUploading] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [openComments, setOpenComments] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Initial fetch
  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data: p } = await supabase
        .from("messages").select("*").eq("channel", "general")
        .order("created_at", { ascending: false }).limit(100);
      if (!mounted) return;
      setPosts((p as Post[]) || []);
      const ids = (p || []).map((x: any) => x.id);
      if (ids.length) {
        const { data: r } = await supabase.from("post_reactions").select("*").in("post_id", ids);
        if (mounted) setReactions((r as Reaction[]) || []);
        const { data: c } = await supabase.from("post_comments").select("post_id").in("post_id", ids);
        if (mounted) {
          const counts: Record<string, number> = {};
          (c || []).forEach((row: any) => { counts[row.post_id] = (counts[row.post_id] || 0) + 1; });
          setCommentsCount(counts);
        }
      }
    })();
    return () => { mounted = false; };
  }, []);

  // Realtime: posts
  useEffect(() => {
    const ch = supabase.channel("feed:messages")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: "channel=eq.general" },
        (payload) => {
          const m = payload.new as Post;
          setPosts((prev) => prev.some(p => p.id === m.id) ? prev : [m, ...prev]);
        })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "messages" },
        (payload) => {
          const id = (payload.old as any).id as string;
          setRemoving((s) => { const n = new Set(s); n.add(id); return n; });
          setTimeout(() => {
            setPosts((prev) => prev.filter(p => p.id !== id));
            setRemoving((s) => { const n = new Set(s); n.delete(id); return n; });
          }, 300);
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  // Realtime: reactions + comments
  useEffect(() => {
    const ch = supabase.channel("feed:engagement")
      .on("postgres_changes", { event: "*", schema: "public", table: "post_reactions" }, (payload) => {
        if (payload.eventType === "INSERT") setReactions((p) => [...p, payload.new as Reaction]);
        else if (payload.eventType === "UPDATE") setReactions((p) => p.map(r => r.id === (payload.new as any).id ? payload.new as Reaction : r));
        else if (payload.eventType === "DELETE") setReactions((p) => p.filter(r => r.id !== (payload.old as any).id));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "post_comments" }, (payload) => {
        if (payload.eventType === "INSERT") {
          const c = payload.new as Comment;
          setCommentsCount((m) => ({ ...m, [c.post_id]: (m[c.post_id] || 0) + 1 }));
        } else if (payload.eventType === "DELETE") {
          const c = payload.old as Comment;
          setCommentsCount((m) => ({ ...m, [c.post_id]: Math.max(0, (m[c.post_id] || 0) - 1) }));
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  // Close menu on outside click
  useEffect(() => {
    if (!menuFor) return;
    const onClick = () => setMenuFor(null);
    window.addEventListener("click", onClick);
    return () => window.removeEventListener("click", onClick);
  }, [menuFor]);

  const visiblePosts = useMemo(() => posts.filter(p => !hidden.has(p.id)), [posts, hidden]);

  const reactionMap = useMemo(() => {
    const m: Record<string, { likes: number; dislikes: number; mine: "like" | "dislike" | null }> = {};
    for (const r of reactions) {
      if (!m[r.post_id]) m[r.post_id] = { likes: 0, dislikes: 0, mine: null };
      if (r.type === "like") m[r.post_id].likes++;
      else m[r.post_id].dislikes++;
      if (r.session_id === session.sessionId) m[r.post_id].mine = r.type;
    }
    return m;
  }, [reactions, session.sessionId]);

  const submitPost = async () => {
    const content = draft.trim();
    if (!content) return;
    setDraft("");
    await supabase.from("messages").insert({
      channel: "general", username: session.username,
      avatar_color: session.avatarColor, content,
    });
  };

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const isImage = file.type.startsWith("image/");
    const isVideo = file.type.startsWith("video/");
    if (!isImage && !isVideo) return alert("Only photos and videos.");
    if (file.size > 25 * 1024 * 1024) return alert("Max 25MB.");
    setUploading(true);
    try {
      const ext = file.name.split(".").pop() || (isImage ? "jpg" : "mp4");
      const path = `general/${session.sessionId}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from("chat-media").upload(path, file, { contentType: file.type });
      if (error) throw error;
      const { data: pub } = supabase.storage.from("chat-media").getPublicUrl(path);
      await supabase.from("messages").insert({
        channel: "general", username: session.username, avatar_color: session.avatarColor,
        content: draft.trim() || (isImage ? "📷 photo" : "🎬 video"),
        media_url: pub.publicUrl, media_type: isImage ? "image" : "video",
      });
      setDraft("");
    } catch (err: any) {
      alert("Upload failed: " + (err?.message || "unknown"));
    } finally {
      setUploading(false);
    }
  };

  const react = async (post: Post, type: "like" | "dislike") => {
    const cur = reactionMap[post.id]?.mine;
    if (cur === type) {
      // remove
      await supabase.from("post_reactions").delete()
        .eq("post_id", post.id).eq("session_id", session.sessionId);
      return;
    }
    // upsert by unique (post_id, session_id)
    await supabase.from("post_reactions")
      .upsert({
        post_id: post.id, session_id: session.sessionId,
        username: session.username, type,
      }, { onConflict: "post_id,session_id" });
  };

  const deleteForMe = (id: string) => {
    const next = new Set(hidden); next.add(id);
    setHidden(next); saveHidden(next); setMenuFor(null);
  };

  const deleteForEveryone = async (post: Post) => {
    if (post.username !== session.username) return;
    setMenuFor(null);
    setRemoving((s) => { const n = new Set(s); n.add(post.id); return n; });
    await supabase.from("messages").delete().eq("id", post.id);
  };

  const adminDeletePost = async (post: Post) => {
    setMenuFor(null);
    setRemoving((s) => { const n = new Set(s); n.add(post.id); return n; });
    try { await adminCall("delete_message", { id: post.id }); }
    catch (e: any) {
      setRemoving((s) => { const n = new Set(s); n.delete(post.id); return n; });
      toast.error("Admin delete failed: " + e.message);
    }
  };
  const adminBan = (post: Post) => {
    setMenuFor(null);
    adminCall("ban_user", { username: post.username })
      .then(() => toast.success(`Banned ${post.username}`))
      .catch((e) => showAdminError(e.message));
  };
  const adminMute = (post: Post) => {
    setMenuFor(null);
    adminCall("mute_user", { username: post.username, minutes: 60 })
      .then(() => toast.success(`Muted ${post.username} for 60m`))
      .catch((e) => toast.error(e.message));
  };

  const sharePost = async (post: Post) => {
    const text = `${post.username} on tt350: ${post.content}`;
    try {
      if (navigator.share) await navigator.share({ title: "tt350", text });
      else { await navigator.clipboard.writeText(text); alert("Copied to clipboard"); }
    } catch {}
  };

  return (
    <div className="mx-auto w-full max-w-2xl px-3 py-5 sm:px-4">
      {/* Composer */}
      <div className="surface-soft mb-4 rounded-2xl p-4 shadow-soft">
        <div className="flex gap-3">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
               style={{ background: session.avatarColor }}>
            {initials(session.username)}
          </div>
          <div className="flex-1">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="What's happening?"
              rows={2}
              className="w-full resize-none bg-transparent text-[15px] leading-snug text-foreground outline-none placeholder:text-muted-foreground/70"
              maxLength={1000}
            />
            <div className="mt-2 flex items-center justify-between">
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-medium text-primary transition hover:bg-primary/10 disabled:opacity-50"
              >
                {uploading
                  ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                  : <ImageIcon className="h-4 w-4" />}
                Media
              </button>
              <input ref={fileRef} type="file" accept="image/*,video/*" className="hidden" onChange={onPickFile} />
              <button
                onClick={submitPost}
                disabled={!draft.trim()}
                className="flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Send className="h-3.5 w-3.5" /> Post
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Feed */}
      {visiblePosts.length === 0 && (
        <div className="surface-soft rounded-2xl py-12 text-center text-sm text-muted-foreground">
          No posts yet. Be the first ✨
        </div>
      )}

      <div className="space-y-3">
        {visiblePosts.map((post) => {
          const r = reactionMap[post.id] || { likes: 0, dislikes: 0, mine: null };
          const isAuthor = post.username === session.username;
          const isRemoving = removing.has(post.id);
          const showComments = openComments === post.id;
          return (
            <article
              key={post.id}
              className={`surface-soft group rounded-2xl p-4 shadow-soft transition-all duration-300 hover:shadow-elegant hover:-translate-y-0.5 ${
                isRemoving ? "opacity-0 scale-95 -translate-y-2" : "opacity-100 animate-message-in"
              }`}
            >
              <header className="flex items-start gap-3">
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
                     style={{ background: post.avatar_color }}>
                  {initials(post.username)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-1.5">
                    <span className="truncate text-sm font-semibold">{post.username}</span>
                    {isAuthor && <span className="text-[10px] uppercase tracking-wider text-primary">you</span>}
                    <span className="text-xs text-muted-foreground">· {timeAgo(post.created_at)}</span>
                  </div>
                </div>
                <div className="relative">
                  <button
                    onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === post.id ? null : post.id); }}
                    className="rounded-full p-1.5 text-muted-foreground opacity-60 transition hover:bg-muted hover:text-foreground group-hover:opacity-100"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                  {menuFor === post.id && (
                    <div
                      onClick={(e) => e.stopPropagation()}
                      className="absolute right-0 top-9 z-30 w-52 overflow-hidden rounded-xl border border-border bg-popover py-1 shadow-elegant animate-message-in"
                    >
                      <button
                        onClick={() => deleteForMe(post.id)}
                        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition hover:bg-muted"
                      >
                        <EyeOff className="h-4 w-4" /> Delete for me
                      </button>
                      {isAuthor && (
                        <button
                          onClick={() => deleteForEveryone(post)}
                          className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-destructive transition hover:bg-destructive/10"
                        >
                          <Trash2 className="h-4 w-4" /> Delete for everyone
                        </button>
                      )}
                      {session.isAdmin && !isAuthor && (
                        <>
                          <button
                            onClick={() => adminDeletePost(post)}
                            className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-amber-500 transition hover:bg-amber-500/10"
                          >
                            <Shield className="h-4 w-4" /> Delete (admin)
                          </button>
                          <button
                            onClick={() => adminBan(post)}
                            className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-rose-500 transition hover:bg-rose-500/10"
                          >
                            <Ban className="h-4 w-4" /> Ban {post.username}
                          </button>
                          <button
                            onClick={() => adminMute(post)}
                            className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-sky-500 transition hover:bg-sky-500/10"
                          >
                            <VolumeX className="h-4 w-4" /> Mute 60m
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </header>

              {post.content && (
                <p className="mt-2 whitespace-pre-wrap break-words pl-[52px] text-[15px] leading-relaxed">
                  {post.content}
                </p>
              )}

              {post.media_url && (
                <div className="mt-3 pl-[52px]">
                  {post.media_type === "image" ? (
                    <a href={post.media_url} target="_blank" rel="noreferrer">
                      <img src={post.media_url} alt="" loading="lazy"
                           className="max-h-[480px] w-full rounded-xl border border-border object-cover transition hover:opacity-95" />
                    </a>
                  ) : (
                    <video src={post.media_url} controls
                           className="max-h-[480px] w-full rounded-xl border border-border" />
                  )}
                </div>
              )}

              {/* Actions */}
              <div className="mt-3 flex items-center gap-1 pl-[52px]">
                <ActionBtn
                  active={r.mine === "like"}
                  onClick={() => react(post, "like")}
                  activeClass="text-rose-500"
                  icon={<Heart className={`h-4 w-4 ${r.mine === "like" ? "fill-current" : ""}`} />}
                  label={r.likes}
                />
                <ActionBtn
                  active={r.mine === "dislike"}
                  onClick={() => react(post, "dislike")}
                  activeClass="text-sky-500"
                  icon={<ThumbsDown className={`h-4 w-4 ${r.mine === "dislike" ? "fill-current" : ""}`} />}
                  label={r.dislikes}
                />
                <ActionBtn
                  active={showComments}
                  onClick={() => setOpenComments(showComments ? null : post.id)}
                  activeClass="text-primary"
                  icon={<MessageCircle className="h-4 w-4" />}
                  label={commentsCount[post.id] || 0}
                />
                <button
                  onClick={() => sharePost(post)}
                  className="ml-auto flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground"
                >
                  <Share2 className="h-4 w-4" />
                </button>
              </div>

              {showComments && <CommentsPanel postId={post.id} session={session} onClose={() => setOpenComments(null)} />}
            </article>
          );
        })}
      </div>
    </div>
  );
}

function ActionBtn({ active, onClick, icon, label, activeClass }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: number | string; activeClass: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-medium transition hover:bg-muted ${
        active ? activeClass : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {icon}
      <span className="tabular-nums">{label}</span>
    </button>
  );
}

function CommentsPanel({ postId, session, onClose }: { postId: string; session: Session; onClose: () => void }) {
  const [items, setItems] = useState<Comment[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase.from("post_comments")
        .select("*").eq("post_id", postId).order("created_at", { ascending: true });
      if (mounted && data) setItems(data as Comment[]);
    })();
    const ch = supabase.channel(`comments:${postId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "post_comments", filter: `post_id=eq.${postId}` },
        (p) => setItems((prev) => prev.some(c => c.id === (p.new as any).id) ? prev : [...prev, p.new as Comment]))
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "post_comments", filter: `post_id=eq.${postId}` },
        (p) => setItems((prev) => prev.filter(c => c.id !== (p.old as any).id)))
      .subscribe();
    return () => { mounted = false; supabase.removeChannel(ch); };
  }, [postId]);

  const send = async () => {
    const content = text.trim();
    if (!content || busy) return;
    setBusy(true); setText("");
    await supabase.from("post_comments").insert({
      post_id: postId, session_id: session.sessionId,
      username: session.username, avatar_color: session.avatarColor, content,
    });
    setBusy(false);
  };

  return (
    <div className="ml-[52px] mt-3 border-t border-border pt-3 animate-message-in">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Comments</span>
        <button onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-muted">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="space-y-2.5">
        {items.map((c) => {
          const mine = c.username === session.username;
          const canDelete = mine || session.isAdmin;
          const onDelete = async () => {
            if (!canDelete) return;
            if (session.isAdmin && !mine) {
              try { await adminCall("delete_comment", { id: c.id }); }
              catch (e: any) { toast.error("Delete failed: " + e.message); }
            } else {
              // Author deletes their own comment. RLS allows DELETE for all,
              // but we guard client-side so others' UI never shows the button.
              await supabase.from("post_comments").delete().eq("id", c.id);
            }
          };
          return (
            <div key={c.id} className="group flex gap-2">
              <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                   style={{ background: c.avatar_color }}>{initials(c.username)}</div>
              <div className="min-w-0 flex-1 rounded-xl bg-muted px-3 py-1.5">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-xs font-semibold">{c.username}</span>
                  {mine && <span className="text-[9px] uppercase tracking-wider text-primary">you</span>}
                  <span className="text-[10px] text-muted-foreground">{timeAgo(c.created_at)}</span>
                </div>
                <div className="break-words text-sm">{c.content}</div>
              </div>
              {canDelete && (
                <button
                  onClick={onDelete}
                  title="Delete comment"
                  className="self-center rounded-md p-1.5 text-muted-foreground opacity-0 transition hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          );
        })}
        {items.length === 0 && <div className="text-xs text-muted-foreground">No comments yet.</div>}
      </div>
      <div className="mt-3 flex items-center gap-2 rounded-full border border-border bg-input px-3 py-1">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); send(); } }}
          placeholder="Write a comment…"
          className="flex-1 bg-transparent py-1.5 text-sm outline-none placeholder:text-muted-foreground/60"
          maxLength={500}
        />
        <button onClick={send} disabled={!text.trim() || busy}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground transition disabled:opacity-40">
          <Send className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
