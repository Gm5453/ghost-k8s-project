
CREATE TABLE public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel TEXT NOT NULL DEFAULT 'general',
  username TEXT NOT NULL,
  avatar_color TEXT NOT NULL DEFAULT '#a855f7',
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_messages_channel_created ON public.messages(channel, created_at DESC);

CREATE TABLE public.presence (
  session_id UUID PRIMARY KEY,
  username TEXT NOT NULL,
  avatar_color TEXT NOT NULL DEFAULT '#a855f7',
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_presence_last_seen ON public.presence(last_seen DESC);

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.presence ENABLE ROW LEVEL SECURITY;

CREATE POLICY "messages_select_all" ON public.messages FOR SELECT USING (true);
CREATE POLICY "messages_insert_all" ON public.messages FOR INSERT WITH CHECK (true);

CREATE POLICY "presence_select_all" ON public.presence FOR SELECT USING (true);
CREATE POLICY "presence_insert_all" ON public.presence FOR INSERT WITH CHECK (true);
CREATE POLICY "presence_update_all" ON public.presence FOR UPDATE USING (true);
CREATE POLICY "presence_delete_all" ON public.presence FOR DELETE USING (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.presence;
ALTER TABLE public.messages REPLICA IDENTITY FULL;
ALTER TABLE public.presence REPLICA IDENTITY FULL;
