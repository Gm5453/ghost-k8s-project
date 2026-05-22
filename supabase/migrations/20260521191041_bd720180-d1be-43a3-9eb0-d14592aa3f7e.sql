
-- Messages
CREATE TABLE IF NOT EXISTS public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel TEXT NOT NULL DEFAULT 'general',
  username TEXT NOT NULL,
  avatar_color TEXT NOT NULL DEFAULT '#a855f7',
  content TEXT NOT NULL,
  media_url TEXT,
  media_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messages_channel_created ON public.messages(channel, created_at DESC);

-- Presence
CREATE TABLE IF NOT EXISTS public.presence (
  session_id UUID PRIMARY KEY,
  username TEXT NOT NULL,
  avatar_color TEXT NOT NULL DEFAULT '#a855f7',
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_presence_last_seen ON public.presence(last_seen DESC);

-- Reactions
CREATE TABLE IF NOT EXISTS public.post_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  session_id uuid NOT NULL,
  username text NOT NULL,
  type text NOT NULL CHECK (type IN ('like','dislike')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (post_id, session_id)
);

-- Comments
CREATE TABLE IF NOT EXISTS public.post_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  session_id uuid NOT NULL,
  username text NOT NULL,
  avatar_color text NOT NULL DEFAULT '#6366f1',
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Admin tables
CREATE TABLE IF NOT EXISTS public.bans (
  username text PRIMARY KEY,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.mutes (
  username text PRIMARY KEY,
  until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.channels (
  id text PRIMARY KEY,
  name text NOT NULL,
  description text,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.messages       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.presence       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_comments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bans           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mutes          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channels       ENABLE ROW LEVEL SECURITY;

CREATE POLICY "messages_select_all"  ON public.messages       FOR SELECT USING (true);
CREATE POLICY "messages_insert_all"  ON public.messages       FOR INSERT WITH CHECK (true);
CREATE POLICY "messages_delete_all"  ON public.messages       FOR DELETE USING (true);
CREATE POLICY "presence_select_all"  ON public.presence       FOR SELECT USING (true);
CREATE POLICY "presence_insert_all"  ON public.presence       FOR INSERT WITH CHECK (true);
CREATE POLICY "presence_update_all"  ON public.presence       FOR UPDATE USING (true);
CREATE POLICY "presence_delete_all"  ON public.presence       FOR DELETE USING (true);
CREATE POLICY "reactions_all_select" ON public.post_reactions FOR SELECT USING (true);
CREATE POLICY "reactions_all_insert" ON public.post_reactions FOR INSERT WITH CHECK (true);
CREATE POLICY "reactions_all_update" ON public.post_reactions FOR UPDATE USING (true);
CREATE POLICY "reactions_all_delete" ON public.post_reactions FOR DELETE USING (true);
CREATE POLICY "comments_all_select"  ON public.post_comments  FOR SELECT USING (true);
CREATE POLICY "comments_all_insert"  ON public.post_comments  FOR INSERT WITH CHECK (true);
CREATE POLICY "comments_all_delete"  ON public.post_comments  FOR DELETE USING (true);
CREATE POLICY "bans_select"          ON public.bans           FOR SELECT USING (true);
CREATE POLICY "mutes_select"         ON public.mutes          FOR SELECT USING (true);
CREATE POLICY "channels_select"      ON public.channels       FOR SELECT USING (true);

-- Server-side ban/mute enforcement
CREATE OR REPLACE FUNCTION public.enforce_message_gates()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.bans WHERE username = NEW.username) THEN
    RAISE EXCEPTION 'user_banned';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.mutes
    WHERE username = NEW.username AND (until IS NULL OR until > now())
  ) THEN
    RAISE EXCEPTION 'user_muted';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS messages_enforce_gates ON public.messages;
CREATE TRIGGER messages_enforce_gates
  BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.enforce_message_gates();

DROP TRIGGER IF EXISTS comments_enforce_gates ON public.post_comments;
CREATE TRIGGER comments_enforce_gates
  BEFORE INSERT ON public.post_comments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_message_gates();

-- Seed channels
INSERT INTO public.channels (id, name, description, is_default) VALUES
  ('general',    'General',                              'Ընդհանուր քննարկում',          true),
  ('containers', 'Կոնտեյն. տեխնոլ. և միկրոծառ.',         'Containers & microservices',   true),
  ('cloud',      'Ամպային տեխ. և համ.',                   'Cloud tech & computing',       true),
  ('conflict',   'Կոնֆլիկտաբանություն',                   'Conflictology',                true),
  ('networks',   'Քոմփ. ցանցերի մոդելավորում',           'Computer network modeling',    true)
ON CONFLICT (id) DO NOTHING;

-- Storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('chat-media', 'chat-media', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "chat_media_public_read"   ON storage.objects;
DROP POLICY IF EXISTS "chat_media_public_insert" ON storage.objects;
DROP POLICY IF EXISTS "chat_media_public_delete" ON storage.objects;
CREATE POLICY "chat_media_public_read"   ON storage.objects FOR SELECT USING (bucket_id = 'chat-media');
CREATE POLICY "chat_media_public_insert" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'chat-media');
CREATE POLICY "chat_media_public_delete" ON storage.objects FOR DELETE USING (bucket_id = 'chat-media');

-- Realtime
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;       EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.presence;       EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.post_reactions; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.post_comments;  EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.channels;       EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.bans;           EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.mutes;          EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.messages       REPLICA IDENTITY FULL;
ALTER TABLE public.presence       REPLICA IDENTITY FULL;
ALTER TABLE public.post_reactions REPLICA IDENTITY FULL;
ALTER TABLE public.post_comments  REPLICA IDENTITY FULL;
ALTER TABLE public.channels       REPLICA IDENTITY FULL;
ALTER TABLE public.bans           REPLICA IDENTITY FULL;
ALTER TABLE public.mutes          REPLICA IDENTITY FULL;
