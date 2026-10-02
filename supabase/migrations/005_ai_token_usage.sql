-- Wispra — monthly AI text token quota
-- Run this in the Supabase dashboard: SQL Editor → New query → paste & run
-- URL: https://supabase.com/dashboard/project/tpiycamfsagesjeciubg/sql/new
--
-- Purely additive: one new table and one new function. No existing table,
-- column, row or function is changed. To undo:
--   DROP FUNCTION public.increment_ai_tokens(uuid, text, bigint);
--   DROP TABLE public.ai_token_usage;

-- ── ai_token_usage ─────────────────────────────────────────────────────────────
-- One row per (user, month). Tracks cumulative LLM tokens (prompt + completion,
-- as reported by Groq) spent through /api/chat/completions with the server key.
-- 'month' is a 'YYYY-MM' string (UTC), same convention as public.usage, so the
-- quota resets by itself on the 1st of each month: a new month has no row yet.

CREATE TABLE IF NOT EXISTS public.ai_token_usage (
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  month       text        NOT NULL,          -- 'YYYY-MM'
  tokens_used bigint      NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, month)
);

-- RLS with no policies: only the service role (server-side) can read/write.
-- The apps read their numbers via /api/usage.
ALTER TABLE public.ai_token_usage ENABLE ROW LEVEL SECURITY;


-- ── increment_ai_tokens ────────────────────────────────────────────────────────
-- Atomically upserts the (user, month) row, adds p_tokens and returns the new
-- total. A single INSERT ... ON CONFLICT DO UPDATE takes the row lock, so
-- concurrent requests from the same user cannot lose each other's tokens.
-- Called server-side by /api/chat/completions after each Groq call.

CREATE OR REPLACE FUNCTION public.increment_ai_tokens(
  p_user_id uuid,
  p_month   text,
  p_tokens  bigint
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total bigint;
BEGIN
  INSERT INTO public.ai_token_usage (user_id, month, tokens_used)
  VALUES (p_user_id, p_month, GREATEST(p_tokens, 0))
  ON CONFLICT (user_id, month)
  DO UPDATE SET
    tokens_used = public.ai_token_usage.tokens_used + EXCLUDED.tokens_used,
    updated_at  = now()
  RETURNING tokens_used INTO v_total;

  RETURN v_total;
END;
$$;

-- Only the service role needs to call this function. Supabase grants EXECUTE on
-- new public functions to anon and authenticated by default, so revoke those
-- explicitly as well as PUBLIC.
REVOKE EXECUTE ON FUNCTION public.increment_ai_tokens(uuid, text, bigint) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.increment_ai_tokens(uuid, text, bigint) TO service_role;
