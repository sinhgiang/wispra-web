import { createClient } from '@supabase/supabase-js'

export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

/** Validates a user's JWT and returns their user ID, or null if invalid. */
export async function validateToken(token: string): Promise<string | null> {
  const supabase = createAdminClient()
  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) return null
  return user.id
}

/** Returns the current month string in 'YYYY-MM' format (UTC). */
export function currentMonth(): string {
  return new Date().toISOString().slice(0, 7)
}
