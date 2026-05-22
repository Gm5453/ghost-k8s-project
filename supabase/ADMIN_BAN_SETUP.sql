-- Run this once in Supabase SQL Editor.
-- It does not delete data. It only enables admin ban/unban writes through
-- the existing backend admin pass when SUPABASE_SERVICE_ROLE_KEY is absent.

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

CREATE OR REPLACE FUNCTION public.admin_upsert_ban(
  p_username text,
  p_reason text,
  p_admin_pass text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  expected_pass text := COALESCE(NULLIF(current_setting('app.admin_pass', true), ''), 'gm456');
  clean_username text := trim(COALESCE(p_username, ''));
BEGIN
  IF COALESCE(p_admin_pass, '') <> expected_pass THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  IF clean_username = '' THEN
    RAISE EXCEPTION 'missing_username' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.bans (username, reason)
  VALUES (clean_username, p_reason)
  ON CONFLICT (username) DO UPDATE
    SET reason = EXCLUDED.reason;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_ban(
  p_username text,
  p_admin_pass text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  expected_pass text := COALESCE(NULLIF(current_setting('app.admin_pass', true), ''), 'gm456');
  clean_username text := trim(COALESCE(p_username, ''));
BEGIN
  IF COALESCE(p_admin_pass, '') <> expected_pass THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  IF clean_username = '' THEN
    RAISE EXCEPTION 'missing_username' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.bans WHERE username = clean_username;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_upsert_ban(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_delete_ban(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_upsert_ban(text, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_delete_ban(text, text) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
