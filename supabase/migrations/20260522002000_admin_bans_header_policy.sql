-- Safe fallback for admin bans when SUPABASE_SERVICE_ROLE_KEY is not set.
-- The server route validates the admin pass before sending x-admin-pass to Supabase.

CREATE OR REPLACE FUNCTION public.is_admin_request()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.headers', true), '')::jsonb ->> 'x-admin-pass',
    ''
  ) = COALESCE(NULLIF(current_setting('app.admin_pass', true), ''), 'gm456');
$$;

REVOKE ALL ON FUNCTION public.is_admin_request() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin_request() TO anon, authenticated, service_role;

DROP POLICY IF EXISTS "bans_admin_insert" ON public.bans;
DROP POLICY IF EXISTS "bans_admin_update" ON public.bans;
DROP POLICY IF EXISTS "bans_admin_delete" ON public.bans;

CREATE POLICY "bans_admin_insert"
  ON public.bans
  FOR INSERT
  WITH CHECK (public.is_admin_request());

CREATE POLICY "bans_admin_update"
  ON public.bans
  FOR UPDATE
  USING (public.is_admin_request())
  WITH CHECK (public.is_admin_request());

CREATE POLICY "bans_admin_delete"
  ON public.bans
  FOR DELETE
  USING (public.is_admin_request());

NOTIFY pgrst, 'reload schema';
