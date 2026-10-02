-- Snapshot of what PRODUCTION really has in place of 001_initial.sql.
-- Test fixture only: never run this against a real database.
--
-- Rebuilt from read-only catalog queries on the production project
-- (tpiycamfsagesjeciubg) on 2026-10-02, as it was before migrations 005 and 006
-- were applied there, so tests can apply them on top. It differs from 001_initial.sql; the
-- differences are listed in supabase/PRODUCTION_DRIFT.md. Tests that must hold
-- on the live database build on this file instead of 001.

-- ── subscriptions ──────────────────────────────────────────────────────────────
CREATE TABLE public.subscriptions (
  id                    uuid        NOT NULL DEFAULT gen_random_uuid(),
  user_id               uuid        NOT NULL,
  plan                  text        NOT NULL DEFAULT 'free'::text,
  polar_subscription_id text,
  polar_customer_id     text,
  current_period_end    timestamptz,
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now(),
  CONSTRAINT subscriptions_pkey PRIMARY KEY (id),
  CONSTRAINT subscriptions_user_id_key UNIQUE (user_id),
  CONSTRAINT subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own subscription" ON public.subscriptions
  FOR SELECT TO public USING (auth.uid() = user_id);

-- ── usage ──────────────────────────────────────────────────────────────────────
CREATE TABLE public.usage (
  id           uuid        NOT NULL DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL,
  month        text        NOT NULL,
  seconds_used integer     DEFAULT 0,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now(),
  CONSTRAINT usage_pkey PRIMARY KEY (id),
  CONSTRAINT usage_user_id_month_key UNIQUE (user_id, month),
  CONSTRAINT usage_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

ALTER TABLE public.usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own usage" ON public.usage
  FOR SELECT TO public USING (auth.uid() = user_id);

-- ── increment_usage ────────────────────────────────────────────────────────────
-- Same body as 001_initial.sql. ACL on production:
--   {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
CREATE FUNCTION public.increment_usage(p_user_id uuid, p_month text, p_seconds integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.usage (user_id, month, seconds_used)
  VALUES (p_user_id, p_month, p_seconds)
  ON CONFLICT (user_id, month)
  DO UPDATE SET seconds_used = public.usage.seconds_used + EXCLUDED.seconds_used;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.increment_usage(uuid, text, integer) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.increment_usage(uuid, text, integer) TO service_role;

-- ── handle_new_user + on_auth_user_created ─────────────────────────────────────
-- Not in the repo at all. Gives every new account a 'free' subscriptions row.
-- SECURITY DEFINER with no search_path set. ACL on production:
--   {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
CREATE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
begin
  insert into public.subscriptions (user_id) values (new.id);
  return new;
end;
$function$;

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
