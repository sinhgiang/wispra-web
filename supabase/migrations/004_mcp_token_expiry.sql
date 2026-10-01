-- Wispra — optional expiry on remote MCP connection tokens
-- Run this in the Supabase dashboard: SQL Editor → New query → paste & run
-- URL: https://supabase.com/dashboard/project/tpiycamfsagesjeciubg/sql/new

-- NULL means the link never expires (unchanged default behavior for existing rows).
-- Set whenever the user generates or rotates the link, from a duration they pick client-side.
ALTER TABLE public.mcp_tokens
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;
