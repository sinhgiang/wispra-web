# Production database vs. this repo

**The production database was not built from `supabase/migrations/001_initial.sql`.**
Read this before writing or applying any migration that touches `subscriptions`,
`usage`, `increment_usage` or signup.

Checked read-only against the production Supabase project `wispra`
(`tpiycamfsagesjeciubg`) on 2026-10-02. Nothing in production was changed to
make it match; this file only records the difference.

## Why they differ

Production was first set up from another file: `supabase-schema.sql` at the root
of the desktop app repo (`sinhgiang/wispra`, "Wispra Phase 3 — Supabase schema").
`001_initial.sql` was run on top of that later. Because it uses
`CREATE TABLE IF NOT EXISTS`, both of its tables were skipped; only its
`CREATE OR REPLACE FUNCTION increment_usage` and the `REVOKE`/`GRANT` after it
took effect.

All migrations were pasted into the Supabase SQL Editor by hand, so Supabase's
own migration list does not record them (see the last section).

## What production really has

### `public.subscriptions`

| | Production | `001_initial.sql` |
|---|---|---|
| Primary key | `id uuid DEFAULT gen_random_uuid()` | `user_id` |
| `user_id` | `NOT NULL`, `UNIQUE` (`subscriptions_user_id_key`), FK to `auth.users` with `ON DELETE CASCADE` | primary key, same FK |
| `created_at` | `timestamptz DEFAULT now()`, nullable | does not exist |
| `updated_at` | `timestamptz DEFAULT now()`, nullable | `NOT NULL DEFAULT now()` |
| Other columns | `plan`, `polar_subscription_id`, `polar_customer_id`, `current_period_end`: same | |
| RLS | enabled, one policy (below) | enabled, no policies |
| Rows | the signup trigger (below) inserts a `'free'` row for each new account | "Free users have no row here" |

### `public.usage`

| | Production | `001_initial.sql` |
|---|---|---|
| Primary key | `id uuid DEFAULT gen_random_uuid()` | `(user_id, month)` |
| `(user_id, month)` | `UNIQUE` (`usage_user_id_month_key`) | primary key |
| `seconds_used` | `integer DEFAULT 0`, nullable | `integer NOT NULL DEFAULT 0` |
| `created_at`, `updated_at` | `timestamptz DEFAULT now()`, nullable | do not exist |
| RLS | enabled, one policy (below) | enabled, no policies |

### Policies that are not in this repo

- `"Users can view own subscription"` on `subscriptions`: `FOR SELECT TO public USING (auth.uid() = user_id)`
- `"Users can view own usage"` on `usage`: `FOR SELECT TO public USING (auth.uid() = user_id)`

A signed-in user can therefore read their own row in both tables directly from
Supabase. `001_initial.sql` says only the service role can.

### Function and trigger that are not in this repo

- `public.handle_new_user()`: trigger function, `SECURITY DEFINER`, owner
  `postgres`, **no `search_path` set**. Inserts `(user_id)` into
  `public.subscriptions` for the new account.
- `on_auth_user_created`: `AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user()`.

If `handle_new_user` fails, signup fails. A migration that changes
`subscriptions` (a new `NOT NULL` column without a default, for example) can
break account creation.

### `public.increment_usage`

Signature and body match `001_initial.sql` (`SECURITY DEFINER`,
`search_path = public`). On production it relies on the `UNIQUE (user_id, month)`
constraint rather than the primary key. It does not touch `usage.updated_at`.

### What does match

- `synced_history`, `synced_meetings`, `synced_lexicon` (`002_sync.sql`)
- `mcp_tokens` (`003_mcp_tokens.sql`) and its `expires_at` column (`004_mcp_token_expiry.sql`)
- `ai_token_usage` and `increment_ai_tokens` (`005_ai_token_usage.sql`), applied 2026-10-02

## What this means for the code

The API routes work on both shapes, because they only use what the two have in
common:

- `subscriptions` is read and upserted by `user_id`, which is unique either way.
- `usage` is read by `(user_id, month)`, which is unique either way.
- A missing `subscriptions` row and a row with `plan = 'free'` are both treated as Free.

## Rules for new migrations

1. Do not assume the structure in `001_initial.sql`. Check production first
   (read-only), or build on `tests/helpers/production-schema.sql`.
2. Do not "fix" production to match `001_initial.sql`, and do not rewrite
   `001_initial.sql` to match production, without the owner's decision. Either
   one is a change to real tables.
3. Test against the production structure: `createProductionLikeDb()` in
   `tests/helpers/test-db.ts` builds an in-memory Postgres from
   `tests/helpers/production-schema.sql` plus migrations 002 onward. If
   production changes outside this repo, update that snapshot and this file.
4. New `public` functions: Supabase grants `EXECUTE` to `anon` and
   `authenticated` directly. `REVOKE ... FROM PUBLIC` alone does not remove
   those grants; name both roles in the `REVOKE`.

## Supabase's migration list

`supabase_migrations` on production holds one entry, `20261002050702 ai_token_usage`
(migration 005, applied through the Supabase tooling). 001 to 004 are not listed
because they were run by hand. An empty or short list there does not mean the
earlier migrations are missing: check the tables themselves.
