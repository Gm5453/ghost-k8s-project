-- =========================================
-- Admin system: bans, mutes, channels
-- All mutations gated to service role (no client policies for INS/UPD/DEL).
-- Public SELECT only.
-- =========================================

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

ALTER TABLE public.bans     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mutes    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channels ENABLE ROW LEVEL SECURITY;

-- public read only; writes are service role (edge function) only
CREATE POLICY "bans_select"     ON public.bans     FOR SELECT USING (true);
CREATE POLICY "mutes_select"    ON public.mutes    FOR SELECT USING (true);
CREATE POLICY "channels_select" ON public.channels FOR SELECT USING (true);

-- Server-side enforcement: banned / muted users cannot insert messages
CREATE OR REPLACE FUNCTION public.enforce_message_gates()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.bans WHERE username = NEW.username) THEN
    RAISE EXCEPTION 'user_banned';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.mutes
    WHERE username = NEW.username
      AND (until IS NULL OR until > now())
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

-- Seed default channels (matches previously hardcoded list)
INSERT INTO public.channels (id, name, description, is_default) VALUES
  ('general',    'General',                              'Ընդհանուր քննարկում',          true),
  ('containers', 'Կոնտեյն. տեխնոլ. և միկրոծառ.',         'Containers & microservices',   true),
  ('cloud',      'Ամպային տեխ. և համ.',                   'Cloud tech & computing',       true),
  ('conflict',   'Կոնֆլիկտաբանություն',                   'Conflictology',                true),
  ('networks',   'Քոմփ. ցանցերի մոդելավորում',           'Computer network modeling',    true)
ON CONFLICT (id) DO NOTHING;

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.channels;
ALTER PUBLICATION supabase_realtime ADD TABLE public.bans;
ALTER PUBLICATION supabase_realtime ADD TABLE public.mutes;
ALTER TABLE public.channels REPLICA IDENTITY FULL;
ALTER TABLE public.bans     REPLICA IDENTITY FULL;
ALTER TABLE public.mutes    REPLICA IDENTITY FULL;
