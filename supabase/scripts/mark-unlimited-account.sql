-- Mark one account as exempt from the monthly limits (needs migration 007).
-- Replace OWNER_EMAIL with the account's sign-in email, then run it in the
-- Supabase SQL Editor. This repo is public: do not commit a real address here.
--
-- Creates the subscriptions row if the account has none, and keeps the plan and
-- Polar fields of an existing row as they are. Returns the account it changed;
-- no row returned means no account has that email.
--
-- To undo for that account:
--   UPDATE public.subscriptions SET unlimited = false, updated_at = now()
--   WHERE user_id = (SELECT id FROM auth.users WHERE lower(email) = lower('OWNER_EMAIL'));

INSERT INTO public.subscriptions (user_id, unlimited)
SELECT id, true
FROM auth.users
WHERE lower(email) = lower('OWNER_EMAIL')
ON CONFLICT (user_id) DO UPDATE
  SET unlimited = true, updated_at = now()
RETURNING user_id, plan, unlimited;
