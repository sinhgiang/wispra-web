-- Wispra — lock SECURITY DEFINER functions down to the roles that need them
-- Run this in the Supabase dashboard: SQL Editor → New query → paste & run
-- URL: https://supabase.com/dashboard/project/tpiycamfsagesjeciubg/sql/new
--
-- Changes privileges only: no table, row, function body or trigger is touched.
-- To undo:
--   GRANT EXECUTE ON FUNCTION public.increment_usage(uuid, text, integer) TO anon, authenticated;
--   GRANT EXECUTE ON FUNCTION public.handle_new_user() TO PUBLIC, anon, authenticated;

-- ── increment_usage ────────────────────────────────────────────────────────────
-- 001_initial.sql revoked EXECUTE from PUBLIC only. Supabase also grants EXECUTE
-- on every new public function to anon and authenticated directly, and those
-- grants survived. Anyone holding the public anon key could therefore call
-- increment_usage through the REST API and inflate any user's transcription
-- seconds (pushing a Free user over the 30-minute limit).
-- The server calls it with the service role key and keeps working.

REVOKE EXECUTE ON FUNCTION public.increment_usage(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.increment_usage(uuid, text, integer) TO service_role;

-- ── handle_new_user ────────────────────────────────────────────────────────────
-- Exists on production only (see supabase/PRODUCTION_DRIFT.md): the trigger
-- function behind on_auth_user_created, which gives each new account its
-- subscriptions row. It was left executable by PUBLIC, anon and authenticated.
-- A trigger function cannot be called directly, so this is tidying rather than
-- closing a live hole.
--
-- Signup is not affected: Postgres checks EXECUTE on a trigger function when
-- the trigger is created, not when it fires. supabase_auth_admin (the role that
-- inserts into auth.users) only had EXECUTE through PUBLIC, so it is granted
-- explicitly to keep that role exactly where it was.
-- Skipped on a database that has no such function (one built from this repo).

DO $$
BEGIN
  IF to_regprocedure('public.handle_new_user()') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN
      GRANT EXECUTE ON FUNCTION public.handle_new_user() TO supabase_auth_admin;
    END IF;
  END IF;
END;
$$;
