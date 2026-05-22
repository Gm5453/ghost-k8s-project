// Admin ops — privileged endpoint backed by the service role.
// Auth model: the request must carry the shared `x-admin-pass` header
// (also accepted as the JSON field `pass`). The pass is the secret admin
// trigger username; rotate by changing ADMIN_PASS env var in Lovable Cloud.
//
// All writes use supabaseAdmin (bypasses RLS). Public reads of bans/mutes
// /channels remain RLS-permitted on the client.
import { createFileRoute } from "@tanstack/react-router";
import { createSupabaseAdminRequestClient, supabaseAdmin } from "@/integrations/supabase/client.server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-admin-pass, apikey",
  "Access-Control-Max-Age": "86400",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });

const ADMIN_BAN_CHANNEL = "__admin_bans";
const ADMIN_BAN_AUTHOR = "__admin__";
const ADMIN_CHANNELS_CHANNEL = "__admin_channels";
const ADMIN_CHANNELS_AUTHOR = "__admin__";

function adminPass() {
  return process.env.ADMIN_PASS ?? "gm456";
}

function isPolicyError(error: any) {
  const message = String(error?.message ?? "").toLowerCase();
  return error?.code === "42501" || message.includes("row-level security") || message.includes("rls");
}

function isMissingRpcError(error: any) {
  const message = String(error?.message ?? "").toLowerCase();
  return error?.code === "PGRST202" || message.includes("could not find the function");
}

function publicAdminError(error: any) {
  const message = String(error?.message ?? "");
  if (message === "ban_not_saved" || message === "ban_not_removed") {
    return { status: 500, error: "Ban change was not saved in Supabase" };
  }
  if (isMissingRpcError(error)) {
    return { status: 503, error: "Admin ban is not configured in Supabase yet" };
  }
  if (error?.code === "42501" || message === "not_authorized") {
    return { status: 403, error: "Admin access required" };
  }
  if (isPolicyError(error)) {
    return { status: 403, error: "Admin action is blocked by database policy" };
  }
  return { status: 500, error: message || "internal_error" };
}

async function upsertFallbackBan(username: string) {
  const { data, error: readError } = await supabaseAdmin
    .from("messages")
    .select("id")
    .eq("channel", ADMIN_BAN_CHANNEL)
    .eq("content", username)
    .limit(1);
  if (readError) throw readError;
  if (data?.length) return;

  const { error } = await supabaseAdmin.from("messages").insert({
    channel: ADMIN_BAN_CHANNEL,
    username: ADMIN_BAN_AUTHOR,
    avatar_color: "#ef4444",
    content: username,
  });
  if (error) throw error;
}

async function upsertBan(username: string, reason: string | null, pass: string) {
  const { error } = await supabaseAdmin.from("bans").upsert({ username, reason });
  if (!error) return;
  if (!isPolicyError(error)) throw error;

  const passClient = createSupabaseAdminRequestClient({ "x-admin-pass": pass });
  const { error: headerError } = await passClient.from("bans").upsert({ username, reason });
  if (!headerError) return;
  if (!isPolicyError(headerError)) throw headerError;

  const { error: rpcError } = await (supabaseAdmin as any).rpc("admin_upsert_ban", {
    p_username: username,
    p_reason: reason,
    p_admin_pass: pass,
  });
  if (!rpcError) return;
  if (!isMissingRpcError(rpcError)) throw rpcError;

  const { error: alternateRpcError } = await (supabaseAdmin as any).rpc("admin_upsert_ban", {
    p_admin_pass: pass,
    p_reason: reason,
    p_username: username,
  });
  if (!alternateRpcError) return;
  if (!isMissingRpcError(alternateRpcError) && !isPolicyError(alternateRpcError)) throw alternateRpcError;

  await upsertFallbackBan(username);
}

async function assertBanned(username: string) {
  const { data: ban, error } = await supabaseAdmin
    .from("bans")
    .select("username")
    .eq("username", username)
    .maybeSingle();
  if (error) throw error;
  if (ban) return;

  const { data: fallbackBan, error: fallbackError } = await supabaseAdmin
    .from("messages")
    .select("id")
    .eq("channel", ADMIN_BAN_CHANNEL)
    .eq("content", username)
    .limit(1);
  if (fallbackError) throw fallbackError;
  if (!fallbackBan?.length) throw new Error("ban_not_saved");
}

async function deleteFallbackBan(username: string) {
  const { error } = await supabaseAdmin
    .from("messages")
    .delete()
    .eq("channel", ADMIN_BAN_CHANNEL)
    .eq("content", username);
  if (error) throw error;
}

async function deleteBan(username: string, pass: string) {
  const { error } = await supabaseAdmin.from("bans").delete().eq("username", username);
  if (!error) {
    await deleteFallbackBan(username);
    return;
  }
  if (!isPolicyError(error)) throw error;

  const passClient = createSupabaseAdminRequestClient({ "x-admin-pass": pass });
  const { error: headerError } = await passClient.from("bans").delete().eq("username", username);
  if (!headerError) return;
  if (!isPolicyError(headerError)) throw headerError;

  const { error: rpcError } = await (supabaseAdmin as any).rpc("admin_delete_ban", {
    p_username: username,
    p_admin_pass: pass,
  });
  if (!rpcError) return;
  if (!isMissingRpcError(rpcError)) throw rpcError;

  const { error: alternateRpcError } = await (supabaseAdmin as any).rpc("admin_delete_ban", {
    p_admin_pass: pass,
    p_username: username,
  });
  if (!alternateRpcError) {
    await deleteFallbackBan(username);
    return;
  }
  if (!isMissingRpcError(alternateRpcError) && !isPolicyError(alternateRpcError)) throw alternateRpcError;

  await deleteFallbackBan(username);
}

async function assertUnbanned(username: string) {
  const { data: ban, error } = await supabaseAdmin
    .from("bans")
    .select("username")
    .eq("username", username)
    .maybeSingle();
  if (error) throw error;
  if (ban) throw new Error("ban_not_removed");

  const { data: fallbackBan, error: fallbackError } = await supabaseAdmin
    .from("messages")
    .select("id")
    .eq("channel", ADMIN_BAN_CHANNEL)
    .eq("content", username)
    .limit(1);
  if (fallbackError) throw fallbackError;
  if (fallbackBan?.length) throw new Error("ban_not_removed");
}

type ChannelPatch = {
  id: string;
  name?: string;
  description?: string | null;
  deleted?: boolean;
};

async function insertChannelPatch(patch: ChannelPatch) {
  const { error } = await supabaseAdmin.from("messages").insert({
    channel: ADMIN_CHANNELS_CHANNEL,
    username: ADMIN_CHANNELS_AUTHOR,
    avatar_color: "#f59e0b",
    content: JSON.stringify({ ...patch, at: new Date().toISOString() }),
  });
  if (error) throw error;
}

async function createChannel(id: string, name: string, description: string | null, pass: string) {
  const { error } = await supabaseAdmin.from("channels").insert({ id, name, description });
  if (!error) return;
  if (!isPolicyError(error)) throw error;

  const passClient = createSupabaseAdminRequestClient({ "x-admin-pass": pass });
  const { error: headerError } = await passClient.from("channels").insert({ id, name, description });
  if (!headerError) return;
  if (!isPolicyError(headerError)) throw headerError;

  await insertChannelPatch({ id, name, description, deleted: false });
}

async function renameChannel(id: string, name: string, description: string | null | undefined, pass: string) {
  const patch = description !== undefined ? { name, description } : { name };
  const { error } = await supabaseAdmin.from("channels").update(patch).eq("id", id);
  if (!error) return;
  if (!isPolicyError(error)) throw error;

  const passClient = createSupabaseAdminRequestClient({ "x-admin-pass": pass });
  const { error: headerError } = await passClient.from("channels").update(patch).eq("id", id);
  if (!headerError) return;
  if (!isPolicyError(headerError)) throw headerError;

  await insertChannelPatch({ id, name, description, deleted: false });
}

async function deleteChannel(id: string, pass: string) {
  await supabaseAdmin.from("messages").delete().eq("channel", id);
  const { error } = await supabaseAdmin.from("channels").delete().eq("id", id);
  if (!error) {
    await insertChannelPatch({ id, deleted: true });
    return;
  }
  if (!isPolicyError(error)) throw error;

  const passClient = createSupabaseAdminRequestClient({ "x-admin-pass": pass });
  const { error: headerError } = await passClient.from("channels").delete().eq("id", id);
  if (!headerError) {
    await insertChannelPatch({ id, deleted: true });
    return;
  }
  if (!isPolicyError(headerError)) throw headerError;

  await insertChannelPatch({ id, deleted: true });
}

async function wipeAll() {
  // Delete in FK-safe order. Comments/reactions cascade from messages,
  // but explicit deletes are cheaper than relying on cascade for huge sets.
  await supabaseAdmin.from("post_comments").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await supabaseAdmin.from("post_reactions").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await supabaseAdmin
    .from("messages")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000")
    .neq("channel", ADMIN_BAN_CHANNEL)
    .neq("channel", ADMIN_CHANNELS_CHANNEL);
  await supabaseAdmin.from("presence").delete().neq("session_id", "00000000-0000-0000-0000-000000000000");
}

export const Route = createFileRoute("/api/public/admin-ops")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),

      POST: async ({ request }) => {
        let body: any;
        try { body = await request.json(); } catch { return json({ error: "bad_json" }, 400); }

        const pass = request.headers.get("x-admin-pass") ?? body?.pass ?? "";
        if (!pass || pass !== adminPass()) return json({ error: "Admin access required" }, 401);

        const action = String(body?.action ?? "");
        if (!action) return json({ error: "missing_action" }, 400);

        try {
          switch (action) {
            case "delete_message": {
              const id = String(body.id ?? "");
              if (!id) return json({ error: "missing_id" }, 400);
              const { error } = await supabaseAdmin.from("messages").delete().eq("id", id);
              if (error) throw error;
              return json({ ok: true });
            }
            case "delete_comment": {
              const id = String(body.id ?? "");
              if (!id) return json({ error: "missing_id" }, 400);
              const { error } = await supabaseAdmin.from("post_comments").delete().eq("id", id);
              if (error) throw error;
              return json({ ok: true });
            }
            case "ban_user": {
              const username = String(body.username ?? "").trim();
              const reason = body.reason ? String(body.reason) : null;
              if (!username) return json({ error: "missing_username" }, 400);
              await upsertBan(username, reason, pass);
              await assertBanned(username);
              await supabaseAdmin.from("presence").delete().eq("username", username);
              return json({ ok: true });
            }
            case "unban_user": {
              const username = String(body.username ?? "").trim();
              if (!username) return json({ error: "missing_username" }, 400);
              await deleteBan(username, pass);
              await assertUnbanned(username);
              return json({ ok: true });
            }
            case "mute_user": {
              const username = String(body.username ?? "").trim();
              const minutes = Number(body.minutes ?? 0);
              if (!username) return json({ error: "missing_username" }, 400);
              const until = minutes > 0 ? new Date(Date.now() + minutes * 60_000).toISOString() : null;
              const { error } = await supabaseAdmin.from("mutes").upsert({ username, until });
              if (error) throw error;
              return json({ ok: true });
            }
            case "unmute_user": {
              const username = String(body.username ?? "").trim();
              if (!username) return json({ error: "missing_username" }, 400);
              const { error } = await supabaseAdmin.from("mutes").delete().eq("username", username);
              if (error) throw error;
              return json({ ok: true });
            }
            case "create_channel": {
              const id = String(body.id ?? "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-");
              const name = String(body.name ?? "").trim();
              const description = body.description ? String(body.description) : null;
              if (!id || !name) return json({ error: "missing_fields" }, 400);
              await createChannel(id, name, description, pass);
              return json({ ok: true, id });
            }
            case "rename_channel": {
              const id = String(body.id ?? "");
              const name = String(body.name ?? "").trim();
              if (!id || !name) return json({ error: "missing_fields" }, 400);
              const description = body.description !== undefined ? String(body.description) : undefined;
              await renameChannel(id, name, description, pass);
              return json({ ok: true });
            }
            case "delete_channel": {
              const id = String(body.id ?? "");
              if (!id) return json({ error: "missing_id" }, 400);
              if (id === "general") return json({ error: "cannot_delete_general" }, 400);
              await deleteChannel(id, pass);
              return json({ ok: true });
            }
            case "wipe_all": {
              // Hard reset: messages, comments, reactions, presence.
              // Channels and bans/mutes are preserved.
              await wipeAll();
              return json({ ok: true });
            }
            default:
              return json({ error: "unknown_action" }, 400);
          }
        } catch (err: any) {
          console.error("[admin-ops]", action, err);
          const { status, error } = publicAdminError(err);
          return json({ error }, status);
        }
      },
    },
  },
});
