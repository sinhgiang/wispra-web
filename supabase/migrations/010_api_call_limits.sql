-- Wispra — per-user limits on how often the apps may call transcription and AI
-- Run this in the Supabase dashboard: SQL Editor → New query → paste & run
-- URL: https://supabase.com/dashboard/project/tpiycamfsagesjeciubg/sql/new
--
-- Purely additive: one new table and one new function. No existing table,
-- column, row or function is changed, and nothing is deleted. To undo:
--   DROP FUNCTION public.take_api_call(uuid, text, integer, integer);
--   DROP TABLE public.api_call_counts;
--
-- Until this is applied, the server lets every call through (it logs that the
-- function is missing): the limits simply do not apply yet.

-- ── api_call_counts ────────────────────────────────────────────────────────────
-- How many calls a user made to one route ('transcribe' or 'chat') in the
-- current window. At most two rows per user and route: one for the current
-- minute and one for the current day (UTC). A row is reused when its window has
-- passed (window_start moves on and calls starts again), so the table does not
-- grow with time and nothing needs cleaning up.

CREATE TABLE IF NOT EXISTS public.api_call_counts (
  user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  route        text        NOT NULL CHECK (route IN ('transcribe', 'chat')),
  period       text        NOT NULL CHECK (period IN ('minute', 'day')),
  window_start timestamptz NOT NULL,
  calls        integer     NOT NULL DEFAULT 0 CHECK (calls >= 0),
  PRIMARY KEY (user_id, route, period)
);

-- RLS with no policies: only the service role (server-side) can read/write.
-- The counts are never shown to the apps.
ALTER TABLE public.api_call_counts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.api_call_counts FROM PUBLIC, anon, authenticated;


-- ── take_api_call ──────────────────────────────────────────────────────────────
-- Counts one call by p_user_id to p_route, if both windows still have room.
-- Returns jsonb:
--   {"allowed": true}
--   {"allowed": false, "period": "minute" | "day", "limit": <n>, "retry_after": <seconds>}
-- A refused call is not counted, so a user who waits as told gets in.
--
-- Both rows are locked (minute first, then day, always in that order) for the
-- rest of the transaction, so concurrent calls by the same user cannot both take
-- the last place. Windows follow the clock in UTC: a minute starts at :00, a day
-- at 00:00 UTC. Called server-side by /api/transcribe and /api/chat/completions.

CREATE OR REPLACE FUNCTION public.take_api_call(
  p_user_id    uuid,
  p_route      text,
  p_per_minute integer,
  p_per_day    integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now        timestamptz := now();
  v_minute     timestamptz := date_trunc('minute', v_now);
  v_day        timestamptz := date_trunc('day', v_now AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_minute_n   integer;
  v_day_n      integer;
BEGIN
  IF p_per_minute IS NULL OR p_per_minute < 1 OR p_per_day IS NULL OR p_per_day < 1 THEN
    RAISE EXCEPTION 'take_api_call: limits must be at least 1';
  END IF;

  -- Make sure both rows exist and belong to the current window, locking them.
  INSERT INTO public.api_call_counts AS c (user_id, route, period, window_start, calls)
  VALUES (p_user_id, p_route, 'minute', v_minute, 0)
  ON CONFLICT (user_id, route, period) DO UPDATE
    SET window_start = EXCLUDED.window_start, calls = 0
    WHERE c.window_start < EXCLUDED.window_start;

  INSERT INTO public.api_call_counts AS c (user_id, route, period, window_start, calls)
  VALUES (p_user_id, p_route, 'day', v_day, 0)
  ON CONFLICT (user_id, route, period) DO UPDATE
    SET window_start = EXCLUDED.window_start, calls = 0
    WHERE c.window_start < EXCLUDED.window_start;

  SELECT calls INTO v_minute_n FROM public.api_call_counts
   WHERE user_id = p_user_id AND route = p_route AND period = 'minute' FOR UPDATE;
  SELECT calls INTO v_day_n FROM public.api_call_counts
   WHERE user_id = p_user_id AND route = p_route AND period = 'day' FOR UPDATE;

  IF v_day_n >= p_per_day THEN
    RETURN jsonb_build_object(
      'allowed', false, 'period', 'day', 'limit', p_per_day,
      'retry_after', GREATEST(1, ceil(extract(epoch FROM (v_day + interval '1 day') - v_now))::integer)
    );
  END IF;
  IF v_minute_n >= p_per_minute THEN
    RETURN jsonb_build_object(
      'allowed', false, 'period', 'minute', 'limit', p_per_minute,
      'retry_after', GREATEST(1, ceil(extract(epoch FROM (v_minute + interval '1 minute') - v_now))::integer)
    );
  END IF;

  UPDATE public.api_call_counts SET calls = calls + 1
   WHERE user_id = p_user_id AND route = p_route;

  RETURN jsonb_build_object('allowed', true);
END;
$$;

-- Only the service role needs to call this function. Supabase grants EXECUTE on
-- new public functions to anon and authenticated by default, so revoke those
-- explicitly as well as PUBLIC.
REVOKE EXECUTE ON FUNCTION public.take_api_call(uuid, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.take_api_call(uuid, text, integer, integer) TO service_role;
