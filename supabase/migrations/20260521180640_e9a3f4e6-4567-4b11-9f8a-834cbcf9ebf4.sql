
-- Allow author to delete their own messages (session-based: no auth, so allow all delete; client gates by author)
CREATE POLICY "messages_delete_all" ON public.messages FOR DELETE USING (true);

-- Reactions table for #general posts
CREATE TABLE public.post_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  session_id uuid NOT NULL,
  username text NOT NULL,
  type text NOT NULL CHECK (type IN ('like','dislike')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (post_id, session_id)
);
ALTER TABLE public.post_reactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "reactions_all_select" ON public.post_reactions FOR SELECT USING (true);
CREATE POLICY "reactions_all_insert" ON public.post_reactions FOR INSERT WITH CHECK (true);
CREATE POLICY "reactions_all_update" ON public.post_reactions FOR UPDATE USING (true);
CREATE POLICY "reactions_all_delete" ON public.post_reactions FOR DELETE USING (true);

-- Comments table for #general posts
CREATE TABLE public.post_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  session_id uuid NOT NULL,
  username text NOT NULL,
  avatar_color text NOT NULL DEFAULT '#6366f1',
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.post_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "comments_all_select" ON public.post_comments FOR SELECT USING (true);
CREATE POLICY "comments_all_insert" ON public.post_comments FOR INSERT WITH CHECK (true);
CREATE POLICY "comments_all_delete" ON public.post_comments FOR DELETE USING (true);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.post_reactions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.post_comments;
ALTER TABLE public.messages REPLICA IDENTITY FULL;
ALTER TABLE public.post_reactions REPLICA IDENTITY FULL;
ALTER TABLE public.post_comments REPLICA IDENTITY FULL;
