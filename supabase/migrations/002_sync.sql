-- Wispra — cloud sync schema
-- Run this in the Supabase dashboard: SQL Editor → New query → paste & run
-- URL: https://supabase.com/dashboard/project/tpiycamfsagesjeciubg/sql/new
--
-- Opt-in mirror of a user's local dictation data (History/Meetings/Lexicon),
-- pushed one-way (device → cloud) by the desktop app via POST /api/sync.
-- Same access model as 001_initial.sql: RLS enabled, no policies — only the
-- service role (server-side, used exclusively by /api/sync) can read/write.

-- ── synced_history ────────────────────────────────────────────────────────────
-- Full-replace on every sync: the desktop app always sends its complete local
-- History snapshot (capped at 100 entries there), so this table is deleted and
-- re-inserted per user on each push rather than upserted incrementally.

CREATE TABLE IF NOT EXISTS public.synced_history (
  user_id          uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  id               text        NOT NULL,
  text             text        NOT NULL,
  raw_text         text,
  created_at       timestamptz NOT NULL,
  app              text,
  topic            text,
  language         text,
  duration_seconds numeric,
  synced_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id)
);

ALTER TABLE public.synced_history ENABLE ROW LEVEL SECURITY;


-- ── synced_meetings ───────────────────────────────────────────────────────────
-- Upserted per session (not full-replace): the desktop app sends only sessions
-- changed since the last sync. A meeting deleted locally is NOT deleted here in
-- this version — known limitation, consistent with the "keep cloud data" choice
-- made for the sync-disable case.

CREATE TABLE IF NOT EXISTS public.synced_meetings (
  user_id          uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  id               text        NOT NULL,
  title            text,
  summary          text,
  created_at       timestamptz NOT NULL,
  duration_ms      bigint,
  status           text,
  segments         jsonb,
  content          jsonb,
  language_config  jsonb,
  space_id         text,
  synced_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id)
);

ALTER TABLE public.synced_meetings ENABLE ROW LEVEL SECURITY;


-- ── synced_lexicon ────────────────────────────────────────────────────────────
-- Full-replace on every sync, same rationale as synced_history (capped at 500
-- entries locally).

CREATE TABLE IF NOT EXISTS public.synced_lexicon (
  user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  id         text        NOT NULL,
  term       text        NOT NULL,
  heard_as   jsonb,
  count      integer,
  enabled    boolean,
  pinned     boolean,
  source     text,
  created_at timestamptz,
  last_seen  timestamptz,
  synced_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id)
);

ALTER TABLE public.synced_lexicon ENABLE ROW LEVEL SECURITY;
