-- Wispra — Custom Vocabulary per account, shared by the desktop and phone apps
-- Run this in the Supabase dashboard: SQL Editor → New query → paste & run
-- URL: https://supabase.com/dashboard/project/tpiycamfsagesjeciubg/sql/new
--
-- Purely additive: one new table. No existing table, column, row or function is
-- changed. To undo:
--   DROP TABLE public.synced_vocabulary;

-- ── synced_vocabulary ──────────────────────────────────────────────────────────
-- One row per user: the names and terms the user wants spelled exactly ("Custom
-- Vocabulary" in the apps; Settings.vocabulary on the desktop). Read and written
-- by GET / PUT /api/lexicon, together with the learned words in synced_lexicon.
-- The apps merge their lists before writing; the server stores what it is sent.

CREATE TABLE IF NOT EXISTS public.synced_vocabulary (
  user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  terms      text[]      NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id)
);

-- RLS with no policies: only the service role (server-side) can read/write.
ALTER TABLE public.synced_vocabulary ENABLE ROW LEVEL SECURITY;
