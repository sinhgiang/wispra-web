import type { SupabaseClient } from '@supabase/supabase-js'

export type Plan = 'free' | 'pro'

export interface Account {
  plan: Plan
  /**
   * Set by hand on a few accounts (migration 007): no monthly limit on AI text
   * or transcription minutes, whatever the plan. Usage is still recorded.
   */
  unlimited: boolean
  currentPeriodEnd: string | null
}

/** Any plan value we do not know is treated as free. */
export function toPlan(plan: unknown): Plan {
  return plan === 'pro' ? 'pro' : 'free'
}

/**
 * The user's plan and limit exemption from public.subscriptions. No row (or a
 * failed read) means a Free account with limits.
 *
 * Selects '*' rather than naming `unlimited`, so this keeps working on a
 * database where migration 007 has not been applied yet.
 */
export async function getAccount(supabase: SupabaseClient, userId: string): Promise<Account> {
  const { data } = await supabase.from('subscriptions').select('*').eq('user_id', userId).maybeSingle()
  return {
    plan: toPlan(data?.plan),
    unlimited: data?.unlimited === true,
    currentPeriodEnd: data?.current_period_end ?? null,
  }
}
