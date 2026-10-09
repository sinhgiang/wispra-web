import type { SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { getAccount } from '@/lib/account'

// ── How often one user may call the routes that spend the server's Groq key ───
// Counted per user, per route, in clock windows (UTC): this minute and today.
// Every plan has the same limits: they are far above what a person does by hand
// (one dictation sends its 30-second parts one after the other; a long file is a
// few hundred parts), and only stop a script or a leaked token from spending the
// shared key. Accounts marked unlimited (subscriptions.unlimited, migration 007:
// the owner's own account) are never refused, as with the monthly minutes and AI
// tokens. Change the numbers here; nothing else needs to be touched.
export const API_CALL_LIMITS = {
  transcribe: { perMinute: 60, perDay: 2_000 },
  chat: { perMinute: 60, perDay: 3_000 },
} as const

export type LimitedRoute = keyof typeof API_CALL_LIMITS

/** Machine-readable error code returned with HTTP 429 when a limit is reached. */
export const RATE_LIMITED_CODE = 'rate_limited'

export type ApiCallDecision =
  | { allowed: true }
  | { allowed: false; period: 'minute' | 'day'; limit: number; retryAfterSeconds: number }

const WHAT: Record<LimitedRoute, string> = { transcribe: 'transcription', chat: 'AI' }

/**
 * Counts one call by `userId` to `route` if the user is still under both limits
 * (take_api_call, migration 010), and says whether it may go on.
 *
 * A refused call is let through when the account is marked unlimited. The flag is
 * read only then, so a call under the limit waits for nothing more. (Refused calls
 * are not counted, so an unlimited account's count stops at the limit.)
 *
 * Fails open: if the count cannot be taken (database error, or migration 010 not
 * applied yet), the call is allowed and the reason logged. A broken counter must
 * not take transcription and AI down with it.
 */
export async function takeApiCall(
  supabase: SupabaseClient,
  userId: string,
  route: LimitedRoute
): Promise<ApiCallDecision> {
  const { perMinute, perDay } = API_CALL_LIMITS[route]
  try {
    const { data, error } = await supabase.rpc('take_api_call', {
      p_user_id: userId,
      p_route: route,
      p_per_minute: perMinute,
      p_per_day: perDay,
    })
    if (error) {
      console.error(`[rate-limit] could not count a ${route} call, allowing it:`, error.message)
      return { allowed: true }
    }
    const result = data as { allowed?: unknown; period?: unknown; limit?: unknown; retry_after?: unknown } | null
    if (result?.allowed !== false) return { allowed: true }
    if ((await getAccount(supabase, userId)).unlimited) return { allowed: true }
    const period = result.period === 'day' ? 'day' : 'minute'
    const retryAfter = Number(result.retry_after)
    return {
      allowed: false,
      period,
      limit: Number(result.limit) || (period === 'day' ? perDay : perMinute),
      retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? Math.ceil(retryAfter) : period === 'day' ? 86_400 : 60,
    }
  } catch (err) {
    console.error(`[rate-limit] could not count a ${route} call, allowing it:`, err)
    return { allowed: true }
  }
}

/** "7s", "12m5s", "5h3m2s": the form Groq writes its waits in, which the apps already read. */
export function waitText(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return `${h ? `${h}h` : ''}${h || m ? `${m}m` : ''}${s}s`
}

/**
 * HTTP 429 for a refused call. Worded like Groq's own limit errors, which the
 * desktop app already reads: "per minute" is waited out and sent again, "per day"
 * is shown to the user. Retry-After carries the same wait in seconds.
 */
export function rateLimitedResponse(
  route: LimitedRoute,
  decision: Extract<ApiCallDecision, { allowed: false }>
): NextResponse {
  const { period, limit, retryAfterSeconds } = decision
  const reset = period === 'day' ? ' It resets at 00:00 UTC.' : ''
  const error =
    `Rate limit reached for ${WHAT[route]} requests per ${period}: Limit ${limit}.` +
    `${reset} Please try again in ${waitText(retryAfterSeconds)}.`
  return NextResponse.json(
    { error, code: RATE_LIMITED_CODE, period, limit, retryAfter: retryAfterSeconds },
    { status: 429, headers: { 'retry-after': String(retryAfterSeconds) } }
  )
}
