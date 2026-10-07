import type { SupabaseClient } from '@supabase/supabase-js'
import { currentMonth } from '@/lib/supabase-server'
import { getAccount, toPlan, type Plan } from '@/lib/account'

// ── Monthly AI text token limits ──────────────────────────────────────────────
// One shared budget per user per calendar month (UTC) for every AI text feature
// that goes through /api/chat/completions with the server's Groq key: dictation
// cleanup, Summary, Website/social tabs, chat, Mind map.
// Counts prompt + completion tokens as reported by Groq.
// Change the two numbers here; nothing else needs to be touched.
export const AI_TOKEN_LIMITS = {
  free: 300_000,
  pro: 5_000_000,
} as const

export type AiPlan = Plan

// One answer may not ask for more than this many tokens (T-0201, C3): the monthly
// quota is checked before the call, so an uncapped max_tokens let one request run
// far past it. Twice the default, so a long summary still fits.
export const DEFAULT_MAX_TOKENS = 8192
export const MAX_TOKENS_CAP = 16_384

/** The max_tokens sent to Groq: the app's number, at most MAX_TOKENS_CAP; the default if it sent none or nonsense. */
export function cappedMaxTokens(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) return DEFAULT_MAX_TOKENS
  return Math.min(Math.floor(value), MAX_TOKENS_CAP)
}

/** Machine-readable error code returned with HTTP 402 when the quota is used up. */
export const AI_QUOTA_EXCEEDED_CODE = 'ai_quota_exceeded'

export interface AiQuotaStatus {
  plan: AiPlan
  /** True for an account exempt from limits; limitTokens is then null. */
  unlimited: boolean
  /** 'YYYY-MM' (UTC) the numbers below belong to. */
  month: string
  limitTokens: number | null
  usedTokens: number
  /** ISO timestamp of the next reset: 00:00 UTC on the 1st of next month. */
  resetAt: string
  exceeded: boolean
}

/** Any plan value we do not know is treated as free. */
export const toAiPlan = toPlan

/** 00:00 UTC on the 1st of the month after `now`. */
export function aiQuotaResetAt(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString()
}

/**
 * Reads the user's plan and this month's token count.
 *
 * Fails open: if the usage row cannot be read (database error, or the
 * ai_token_usage table is not there yet), usage counts as 0 and the request is
 * allowed. A broken counter must not take every AI feature down with it.
 */
export async function getAiQuotaStatus(
  supabase: SupabaseClient,
  userId: string
): Promise<AiQuotaStatus> {
  const month = currentMonth()

  const [account, { data: usage, error: usageError }] = await Promise.all([
    getAccount(supabase, userId),
    supabase
      .from('ai_token_usage')
      .select('tokens_used')
      .eq('user_id', userId)
      .eq('month', month)
      .maybeSingle(),
  ])

  if (usageError) {
    console.error('[ai-quota] could not read ai_token_usage, allowing request:', usageError.message)
  }

  const { plan, unlimited } = account
  const limitTokens = unlimited ? null : AI_TOKEN_LIMITS[plan]
  const usedTokens = Number(usage?.tokens_used ?? 0)

  return {
    plan,
    unlimited,
    month,
    limitTokens,
    usedTokens,
    resetAt: aiQuotaResetAt(),
    exceeded: limitTokens !== null && usedTokens >= limitTokens,
  }
}

/**
 * Adds tokens to the user's monthly count. Best-effort: returns false instead
 * of throwing, so a failed write never costs the user their AI result.
 */
export async function recordAiTokens(
  supabase: SupabaseClient,
  userId: string,
  month: string,
  tokens: number
): Promise<boolean> {
  if (!Number.isFinite(tokens) || tokens <= 0) return true
  try {
    const { error } = await supabase.rpc('increment_ai_tokens', {
      p_user_id: userId,
      p_month: month,
      p_tokens: Math.ceil(tokens),
    })
    if (error) {
      console.error('[ai-quota] could not record tokens:', error.message)
      return false
    }
    return true
  } catch (err) {
    console.error('[ai-quota] could not record tokens:', err)
    return false
  }
}
