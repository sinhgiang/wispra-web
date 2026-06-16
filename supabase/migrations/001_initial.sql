-- Wispra — initial database schema
-- Run this in the Supabase dashboard: SQL Editor → New query → paste & run
-- URL: https://supabase.com/dashboard/project/tpiycamfsagesjeciubg/sql/new

-- ── subscriptions ──────────────────────────────────────────────────────────────
-- One row per user. Created by the Polar webhook on first purchase.
-- Free users have no row here (plan defaults to 'free' in application code).

CREATE TABLE IF NOT EXISTS public.subscriptions (
  user_id               uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan                  text        NOT NULL DEFAULT 'free',   -- 'free' | 'pro'
  polar_subscription_id text,
  polar_customer_id     text,
  current_period_end    timestamptz,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id)
);

-- RLS: only the service role (server-side) can read/write this table.
-- No public access is needed — the Electron app fetches account info via /api/usage.
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;


-- ── usage ──────────────────────────────────────────────────────────────────────
-- One row per (user, month). Tracks cumulative seconds of audio transcribed.
-- 'month' is a 'YYYY-MM' string (UTC), e.g. '2026-06'.

CREATE TABLE IF NOT EXISTS public.usage (
  user_id      uuid    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  month        text    NOT NULL,          -- 'YYYY-MM'
  seconds_used integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, month)
);

ALTER TABLE public.usage ENABLE ROW LEVEL SECURITY;


-- ── increment_usage ────────────────────────────────────────────────────────────
-- Atomically upserts a usage row and adds p_seconds to seconds_used.
-- Called server-side by /api/transcribe after each successful transcription.
-- SECURITY DEFINER so it can bypass RLS; SET search_path locks it to public schema.

CREATE OR REPLACE FUNCTION public.increment_usage(
  p_user_id uuid,
  p_month   text,
  p_seconds integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.usage (user_id, month, seconds_used)
  VALUES (p_user_id, p_month, p_seconds)
  ON CONFLICT (user_id, month)
  DO UPDATE SET seconds_used = public.usage.seconds_used + EXCLUDED.seconds_used;
END;
$$;

-- Only the service role needs to call this function
REVOKE EXECUTE ON FUNCTION public.increment_usage FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.increment_usage TO service_role;
