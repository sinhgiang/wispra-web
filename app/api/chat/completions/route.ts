import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, validateToken } from '@/lib/supabase-server'
import { AI_QUOTA_EXCEEDED_CODE, cappedMaxTokens, getAiQuotaStatus, recordAiTokens } from '@/lib/ai-quota'
import { cleanGroqError } from '@/lib/groq-errors'

const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions'

// Whitelist of Groq models clients (desktop, mobile) are allowed to request.
// llama-3.3-70b-versatile was retired by Groq (now 404s) — keep it out of the
// whitelist so a stale client requesting it falls back to a live default
// instead of being routed straight to a dead model.
const ALLOWED_MODELS = new Set([
  'openai/gpt-oss-120b',
  'llama-3.1-8b-instant',
  'llama3-70b-8192',
  'llama3-8b-8192',
  'mixtral-8x7b-32768',
  'gemma2-9b-it',
])

const DEFAULT_MODEL = 'openai/gpt-oss-120b'

// Asked once when DEFAULT_MODEL has reached its daily limit (it has its own
// daily allowance). An answer from it carries `backup_model` in the body and
// this header, so clients can say a backup model wrote it.
const BACKUP_MODEL = 'openai/gpt-oss-20b'
const BACKUP_MODEL_HEADER = 'x-wispra-backup-model'

type GroqAttempt =
  | { response: Response; text: string; result: unknown }
  | { failed: 'timeout' | 'network-error' }

/** A 429 that is about a daily allowance (tokens or requests per day), not a per-minute one. */
function isDailyLimit(status: number, text: string): boolean {
  return status === 429 && /per day|\((?:TPD|RPD)\)/i.test(text)
}

// The desktop app waits 60 s for an AI call; give Groq a little less, so a slow
// answer still arrives instead of the proxy giving up first.
const GROQ_TIMEOUT_MS = 55_000

/** JSON mode is passed on; any other response_format is dropped. */
function allowedResponseFormat(value: unknown): { type: 'json_object' } | undefined {
  const type = (value as { type?: unknown } | null | undefined)?.type
  return type === 'json_object' ? { type: 'json_object' } : undefined
}

/** Groq's rate-limit headers, passed back so the app can wait the right time. */
function rateLimitHeaders(from: Headers): Headers {
  const out = new Headers()
  from.forEach((value, name) => {
    if (name === 'retry-after' || name.startsWith('x-ratelimit-')) out.set(name, value)
  })
  return out
}

/**
 * One line per AI call in the server log, so a failure reported by a user can be
 * traced to what Groq answered. Sizes and status only: never the text of a prompt
 * or an answer, never the user. Groq's error message is kept (it carries no user
 * content: limits, model, request size).
 */
function logCall(call: {
  status: number | 'timeout' | 'network-error'
  model: string | undefined
  jsonMode: boolean
  maxTokens: number
  messages: unknown[]
  started: number
  result?: unknown
  errorText?: string
  /** Set on the second call: the model whose daily limit sent us to this backup. */
  backupFor?: string
  /** What Groq's rate-limit headers say about the server key. */
  limits?: Record<string, number>
}): void {
  const data = call.result as
    | { usage?: { prompt_tokens?: number; completion_tokens?: number }; choices?: { finish_reason?: string; message?: { content?: string } }[] }
    | null
    | undefined
  const choice = data?.choices?.[0]
  const line = {
    route: 'chat/completions',
    status: call.status,
    model: call.model,
    jsonMode: call.jsonMode,
    maxTokens: call.maxTokens,
    promptChars: JSON.stringify(call.messages).length,
    promptTokens: data?.usage?.prompt_tokens,
    completionTokens: data?.usage?.completion_tokens,
    finishReason: choice?.finish_reason,
    answerChars: typeof choice?.message?.content === 'string' ? choice.message.content.length : undefined,
    ms: Date.now() - call.started,
    ...(call.backupFor ? { backupFor: call.backupFor } : {}),
    ...(call.limits && Object.keys(call.limits).length ? { limits: call.limits } : {}),
    ...(call.errorText ? { groqError: groqErrorMessage(call.errorText) } : {}),
  }
  if (typeof call.status === 'number' && call.status < 400) console.info('[ai-call]', JSON.stringify(line))
  else console.error('[ai-call]', JSON.stringify(line))
}

/**
 * Groq's rate-limit headers as numbers: requests per day (limit and left today)
 * and tokens per minute (limit and left this minute). Groq does not send the
 * tokens left today; that only shows in a daily-limit error.
 */
function groqLimits(headers: Headers): Record<string, number> {
  const fields: [string, string][] = [
    ['requestsPerDay', 'x-ratelimit-limit-requests'],
    ['requestsLeftToday', 'x-ratelimit-remaining-requests'],
    ['tokensPerMinute', 'x-ratelimit-limit-tokens'],
    ['tokensLeftThisMinute', 'x-ratelimit-remaining-tokens'],
  ]
  const out: Record<string, number> = {}
  for (const [key, header] of fields) {
    const value = Number(headers.get(header))
    if (headers.has(header) && Number.isFinite(value)) out[key] = value
  }
  return out
}

/** Groq's error message (limits, model, sizes), without any failed generation text. */
function groqErrorMessage(text: string): string {
  try {
    const error = (JSON.parse(text) as { error?: { message?: unknown; code?: unknown; type?: unknown } }).error
    const parts = [error?.code, error?.type, error?.message].filter(p => typeof p === 'string')
    if (parts.length) return parts.join(' | ').slice(0, 400)
  } catch { /* not JSON */ }
  return text.slice(0, 200)
}

/** Tokens Groq billed for this call (prompt + completion), or null if it did not say. */
function billedTokens(payload: unknown): number | null {
  const usage = (payload as { usage?: Record<string, unknown> } | null)?.usage
  if (!usage || typeof usage !== 'object') return null
  if (typeof usage.total_tokens === 'number') return usage.total_tokens
  const prompt = typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : 0
  const completion = typeof usage.completion_tokens === 'number' ? usage.completion_tokens : 0
  return prompt + completion > 0 ? prompt + completion : null
}

/** Rough fallback (about 3 characters per token) for a successful call with no usage block. */
function estimateTokens(messages: unknown[], responseText: string): number {
  return Math.ceil((JSON.stringify(messages).length + responseText.length) / 3)
}

export async function POST(req: NextRequest) {
  // ── Auth ────────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const token = authHeader.slice(7)
  const userId = await validateToken(token)
  if (!userId) {
    return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 })
  }

  // ── Parse body ──────────────────────────────────────────────────────────────
  let body: {
    model?: string
    messages?: unknown[]
    max_tokens?: number
    temperature?: number
    stream?: boolean
    response_format?: unknown
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // Reject streaming — the Electron client never requests it and it complicates proxying
  if (body.stream) {
    return NextResponse.json({ error: 'Streaming not supported via proxy' }, { status: 400 })
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return NextResponse.json({ error: 'messages must be a non-empty array' }, { status: 400 })
  }

  // Enforce safe model — don't let clients route to arbitrary or expensive models
  const model = body.model && ALLOWED_MODELS.has(body.model) ? body.model : DEFAULT_MODEL

  // ── Monthly token quota ─────────────────────────────────────────────────────
  // Checked once, before the call. A request that is let in always runs to the
  // end, even if it takes the user past the limit; the next one is refused.
  // Accounts marked unlimited are never refused, but their tokens are counted.
  const supabase = createAdminClient()
  const quota = await getAiQuotaStatus(supabase, userId)
  if (quota.exceeded && quota.limitTokens !== null) {
    const limit = quota.limitTokens.toLocaleString('en-US')
    const resetDay = quota.resetAt.slice(0, 10)
    const error =
      quota.plan === 'free'
        ? `Monthly AI limit reached (${limit} tokens on the Free plan). It resets on ${resetDay}. Upgrade to Pro for a higher limit.`
        : `Monthly AI limit reached (${limit} tokens). It resets on ${resetDay}.`
    return NextResponse.json(
      {
        error,
        code: AI_QUOTA_EXCEEDED_CODE,
        plan: quota.plan,
        limitTokens: quota.limitTokens,
        usedTokens: quota.usedTokens,
        resetAt: quota.resetAt,
      },
      { status: 402 }
    )
  }

  // ── Forward to Groq ─────────────────────────────────────────────────────────
  // Behave like a direct Groq call, so the app handles both paths the same way:
  // JSON mode is passed on, and Groq's rate-limit headers come back.
  const responseFormat = allowedResponseFormat(body.response_format)
  const maxTokens = cappedMaxTokens(body.max_tokens)
  const messages = body.messages

  /** One call to Groq with `withModel`; its tokens are recorded and it is logged. */
  const callGroq = async (withModel: string, backupFor?: string): Promise<GroqAttempt> => {
    const started = Date.now()
    const log = { model: withModel, jsonMode: !!responseFormat, maxTokens, messages, started, backupFor }
    let response: Response
    let text: string
    try {
      response = await fetch(GROQ_CHAT_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: withModel,
          messages,
          max_tokens: maxTokens,
          temperature: body.temperature ?? 0,
          ...(responseFormat ? { response_format: responseFormat } : {}),
        }),
        signal: AbortSignal.timeout(GROQ_TIMEOUT_MS),
      })
      text = await response.text()
    } catch (err) {
      const timedOut = err instanceof Error && err.name === 'TimeoutError'
      logCall({ ...log, status: timedOut ? 'timeout' : 'network-error' })
      return { failed: timedOut ? 'timeout' : 'network-error' }
    }

    let result: unknown = null
    try {
      result = JSON.parse(text)
    } catch { /* not JSON — handled by the caller */ }

    // Recorded before any response is returned, so the tokens are counted even if
    // the client has gone away, and for Groq errors that still report usage.
    // Best-effort: a failed write does not fail the response.
    const tokens = billedTokens(result) ?? (response.ok ? estimateTokens(messages, text) : 0)
    await recordAiTokens(supabase, userId, quota.month, tokens)

    logCall({ ...log, status: response.status, result, errorText: response.ok ? undefined : text, limits: groqLimits(response.headers) })
    return { response, text, result }
  }

  const first = await callGroq(model)
  if ('failed' in first) {
    const msg = first.failed === 'timeout' ? 'AI request timed out' : 'Network error contacting AI service'
    return NextResponse.json({ error: msg }, { status: 503 })
  }

  // ── Backup model after a daily limit ────────────────────────────────────────
  // Groq's free tier gives each model its own daily token allowance. When the
  // main model has used its allowance for the day, ask the smaller model once,
  // and say so in the answer. If that fails too, the original daily-limit error
  // goes back exactly as before, so the app tells the user about the limit.
  let used = first
  let backupModel: string | undefined
  if (model === DEFAULT_MODEL && isDailyLimit(first.response.status, first.text)) {
    const second = await callGroq(BACKUP_MODEL, model)
    if (!('failed' in second) && second.response.ok && second.result !== null) {
      used = second
      backupModel = BACKUP_MODEL
    }
  }

  const headers = rateLimitHeaders(used.response.headers)

  if (!used.response.ok) {
    return NextResponse.json({ error: cleanGroqError(used.text) }, { status: used.response.status, headers })
  }

  if (used.result === null) {
    return NextResponse.json({ error: 'Invalid response from AI service' }, { status: 502 })
  }

  if (backupModel) {
    headers.set(BACKUP_MODEL_HEADER, backupModel)
    return NextResponse.json({ ...(used.result as object), backup_model: backupModel }, { headers })
  }
  return NextResponse.json(used.result, { headers })
}
