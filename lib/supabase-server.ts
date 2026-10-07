import { createClient } from '@supabase/supabase-js'

export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

/** One client for checking tokens, so the project's public signing keys stay cached. */
let tokenChecker: ReturnType<typeof createAdminClient> | null = null

/**
 * Validates a signed-in user's access token and returns their user id, or null.
 *
 * The signature and expiry are checked here with the project's public keys
 * (auth.getClaims, keys cached for 10 minutes) instead of a call to Supabase Auth
 * per request (T-0201, L5): a flood of fake tokens no longer becomes a flood of
 * requests to Supabase. Tokens signed with the old shared secret (HS256) still
 * go to Supabase Auth, as getClaims does by itself.
 *
 * Only a signed-in user's token passes: role "authenticated" and a user id. The
 * project's anon or service keys are JWTs too, and are refused.
 *
 * Trade-off: a session signed out elsewhere keeps working until its token
 * expires (Supabase access tokens last 1 hour by default).
 */
export async function validateToken(token: string): Promise<string | null> {
  tokenChecker ??= createAdminClient()
  const { data, error } = await tokenChecker.auth.getClaims(token)
  if (error || !data) return null
  const { sub, role } = data.claims as { sub?: unknown; role?: unknown }
  if (typeof sub !== 'string' || !sub || role !== 'authenticated') return null
  return sub
}

/** Returns the current month string in 'YYYY-MM' format (UTC). */
export function currentMonth(): string {
  return new Date().toISOString().slice(0, 7)
}
