-- Wispra — lock increment_usage down to the service role
-- Run this in the Supabase dashboard: SQL Editor → New query → paste & run
-- URL: https://supabase.com/dashboard/project/tpiycamfsagesjeciubg/sql/new
--
-- 001_initial.sql revoked EXECUTE on increment_usage from PUBLIC only. Supabase
-- also grants EXECUTE on every new public function to anon and authenticated
-- directly, and those grants survived. Anyone holding the public anon key could
-- therefore call increment_usage through the REST API and inflate any user's
-- transcription seconds (pushing a Free user over the 30-minute limit).
--
-- Changes privileges only: no table, row or function body is touched. The
-- server calls increment_usage with the service role key and keeps working.
-- To undo:
--   GRANT EXECUTE ON FUNCTION public.increment_usage(uuid, text, integer) TO anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.increment_usage(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.increment_usage(uuid, text, integer) TO service_role;
