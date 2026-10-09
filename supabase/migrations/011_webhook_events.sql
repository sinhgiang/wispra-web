-- Wispra — Polar webhook deliveries already handled, so each event is applied once
-- Run this in the Supabase dashboard: SQL Editor → New query → paste & run
-- URL: https://supabase.com/dashboard/project/tpiycamfsagesjeciubg/sql/new
--
-- Purely additive: one new table. No existing table, column, row or function is
-- changed. To undo:
--   DROP TABLE public.webhook_events;
--
-- (010 is api_call_counts, on the helme/rate-limit branch; this file does not
-- depend on it.)

-- ── webhook_events ─────────────────────────────────────────────────────────────
-- One row per webhook delivery the server accepted, keyed by the Standard
-- Webhooks `webhook-id` header. Polar sends the same id again when it retries,
-- so POST /api/webhook/polar inserts the id first and skips the event when the
-- id is already here. A row is removed again when handling the event failed,
-- so Polar's retry is applied.

CREATE TABLE IF NOT EXISTS public.webhook_events (
  webhook_id  text        NOT NULL,
  source      text        NOT NULL DEFAULT 'polar',
  event_type  text,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (webhook_id)
);

-- RLS with no policies: only the service role (server-side) can read/write.
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;
