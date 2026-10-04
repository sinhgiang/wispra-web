-- Wispra — remember deleted history entries, so a deletion reaches every device
-- Run this in the Supabase dashboard: SQL Editor → New query → paste & run
-- URL: https://supabase.com/dashboard/project/tpiycamfsagesjeciubg/sql/new
--
-- Purely additive: one new table. No existing table, column, row or function is
-- changed. To undo:
--   DROP TABLE public.synced_history_deletions;

-- ── synced_history_deletions ───────────────────────────────────────────────────
-- One row per deleted history entry ("tombstone"): which entry of which user was
-- deleted, and when. Ids only, never the text that was dictated.
--
-- - GET /api/history?since=… returns the ids deleted since a device last asked,
--   so the other devices delete them too.
-- - /api/sync (desktop) and /api/history/merge (phone) skip deleted ids, so a
--   device that has not heard of a deletion yet cannot bring the entry back.
-- - The special id '*' records "delete everything": its deleted_at is the moment
--   of the last clear, and entries created before it are skipped the same way.

CREATE TABLE IF NOT EXISTS public.synced_history_deletions (
  user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  id         text        NOT NULL,          -- the deleted entry's id, or '*'
  deleted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id)
);

-- "What was deleted since …" for one user.
CREATE INDEX IF NOT EXISTS synced_history_deletions_user_deleted_at
  ON public.synced_history_deletions (user_id, deleted_at);

-- RLS with no policies: only the service role (server-side) can read/write.
ALTER TABLE public.synced_history_deletions ENABLE ROW LEVEL SECURITY;
