-- Wispra — exempt chosen accounts from the monthly limits
-- Run this in the Supabase dashboard: SQL Editor → New query → paste & run
-- URL: https://supabase.com/dashboard/project/tpiycamfsagesjeciubg/sql/new
--
-- Adds one column to public.subscriptions. Every existing row gets false, so no
-- account's limits change until someone is marked by hand
-- (supabase/scripts/mark-unlimited-account.sql). With unlimited = true the
-- server skips the monthly AI text token limit and the Free transcription-minute
-- limit for that account; usage is still recorded.
--
-- Works on both shapes of subscriptions (see supabase/PRODUCTION_DRIFT.md): it
-- only adds a column. The Polar webhook upserts name their columns, so a
-- subscription change does not reset this flag. The existing SELECT policy lets
-- a user read their own flag but not change it; only the service role writes.
--
-- Constant default: Postgres adds the column without rewriting the table.
-- To undo:
--   ALTER TABLE public.subscriptions DROP COLUMN unlimited;

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS unlimited boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.subscriptions.unlimited IS
  'Set by hand: no monthly AI text or transcription-minute limit for this account. Usage is still recorded.';
