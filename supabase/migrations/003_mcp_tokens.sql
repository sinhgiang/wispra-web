-- Wispra — remote MCP connection tokens
-- Run this in the Supabase dashboard: SQL Editor → New query → paste & run
-- URL: https://supabase.com/dashboard/project/tpiycamfsagesjeciubg/sql/new

-- ── mcp_tokens ─────────────────────────────────────────────────────────────────
-- One row per user. Lets ChatGPT/Claude.ai/Grok/etc. reach a remote MCP endpoint
-- (/api/mcp/[token]) that reads that user's synced_* cloud data. Only a hash of the
-- token is stored; the plaintext lives solely in the connection URL the user copies
-- into their AI client. Regenerating the link overwrites token_hash, instantly
-- invalidating the old URL.

CREATE TABLE IF NOT EXISTS public.mcp_tokens (
  user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash   text        NOT NULL UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  PRIMARY KEY (user_id)
);

-- RLS: only the service role (server-side) can read/write this table.
-- No public access is needed — both /api/mcp/token and /api/mcp/[token] run server-side.
ALTER TABLE public.mcp_tokens ENABLE ROW LEVEL SECURITY;
