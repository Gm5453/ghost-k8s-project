import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowRight, Hash, Sun, Moon } from "lucide-react";
import { setSession, getSession } from "@/lib/session";
import { useTheme } from "@/hooks/use-theme";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/")({
  component: LoginPage,
  head: () => ({
    meta: [
      { title: "tt350 — Join the chat" },
      { name: "description", content: "Pick a username and join tt350 — calm, minimal realtime chat." },
    ],
  }),
});

// Latin letters, digits and underscore only — restrict to one alphabet.
const USERNAME_RE = /^[a-zA-Z0-9_]+$/;
const ADMIN_BAN_CHANNEL = "__admin_bans";

function LoginPage() {
  const navigate = useNavigate();
  const { theme, toggle } = useTheme();
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const s = getSession();
    if (s) navigate({ to: "/chat" });
  }, [navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const name = username.trim();
    if (name.length < 2 || name.length > 24) {
      setError("Username must be 2–24 characters.");
      return;
    }
    if (!USERNAME_RE.test(name)) {
      setError("Only Latin letters, digits and _ are allowed.");
      return;
    }
    setLoading(true);
    const [{ data: ban }, { data: fallbackBan }] = await Promise.all([
      supabase.from("bans").select("username").eq("username", name).maybeSingle(),
      supabase.from("messages").select("id").eq("channel", ADMIN_BAN_CHANNEL).eq("content", name).limit(1),
    ]);
    if (ban || fallbackBan?.length) {
      setLoading(false);
      setError("You are banned from this chat.");
      toast.error("You are banned");
      return;
    }
    setSession(name);
    setTimeout(() => navigate({ to: "/chat" }), 200);
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4 py-12">
      <button
        onClick={toggle}
        className="absolute right-4 top-4 rounded-md border border-border bg-card p-2 text-muted-foreground transition hover:text-foreground"
        title="Toggle theme"
      >
        {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </button>

      <div className="relative z-10 w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl gradient-primary">
            <Hash className="h-6 w-6 text-primary-foreground" />
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">tt350</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Calm, minimal realtime chat
          </p>
        </div>

        <form onSubmit={submit} className="rounded-xl border border-border bg-card p-5 shadow-soft">
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
            Username
          </label>
          <input
            autoFocus
            value={username}
            onChange={(e) => { setUsername(e.target.value); if (error) setError(null); }}
            placeholder="your_name"
            maxLength={24}
            className="w-full rounded-md border border-border bg-input px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 outline-none transition focus:focus-ring"
          />
          <p className="mt-1.5 text-xs text-muted-foreground">
            2–24 chars · Latin letters, digits, underscore
          </p>
          {error && (
            <p className="mt-2 rounded-md bg-destructive/10 px-2.5 py-1.5 text-xs font-medium text-destructive">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || username.trim().length < 2}
            className="group mt-4 flex w-full items-center justify-center gap-2 rounded-md gradient-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Joining…" : "Join chat"}
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </button>
        </form>

        <div className="mt-6 text-center text-xs text-muted-foreground">
          Containers · Cloud · Conflictology · Networks
        </div>
      </div>
    </div>
  );
}
