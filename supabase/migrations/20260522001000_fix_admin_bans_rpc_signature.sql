-- Ensure the canonical RPC argument names used by the backend exist:
-- public.admin_upsert_ban(p_username, p_reason, p_admin_pass)
-- public.admin_delete_ban(p_username, p_admin_pass)

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
