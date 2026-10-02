import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, validateToken } from '@/lib/supabase-server'
import { AI_QUOTA_EXCEEDED_CODE, getAiQuotaStatus, recordAiTokens } from '@/lib/ai-quota'

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
  const model = ALLOWED_MODELS.has(body.model ?? '') ? body.model : DEFAULT_MODEL

  // ── Monthly token quota ─────────────────────────────────────────────────────
  // Checked once, before the call. A request that is let in always runs to the
  // end, even if it takes the user past the limit; the next one is refused.
  const supabase = createAdminClient()
  const quota = await getAiQuotaStatus(supabase, userId)
  if (quota.exceeded) {
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
  let groqResponse: Response
  let text: string
  try {
    groqResponse = await fetch(GROQ_CHAT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: body.messages,
        max_tokens: body.max_tokens ?? 8192,
        temperature: body.temperature ?? 0,
      }),
      signal: AbortSignal.timeout(35_000),
    })
    text = await groqResponse.text()
  } catch (err) {
    const msg =
      err instanceof Error && err.name === 'TimeoutError'
        ? 'AI request timed out'
        : 'Network error contacting AI service'
    return NextResponse.json({ error: msg }, { status: 503 })
  }

  let result: unknown = null
  try {
    result = JSON.parse(text)
  } catch { /* not JSON — handled below */ }

  // ── Record usage ────────────────────────────────────────────────────────────
  // Awaited before any response is returned, so the tokens are counted even if
  // the client has gone away, and for Groq errors that still report usage.
  // Best-effort: a failed write does not fail the response.
  const tokens =
    billedTokens(result) ?? (groqResponse.ok ? estimateTokens(body.messages, text) : 0)
  await recordAiTokens(supabase, userId, quota.month, tokens)

  if (!groqResponse.ok) {
    return NextResponse.json({ error: text }, { status: groqResponse.status })
  }

  if (result === null) {
    return NextResponse.json({ error: 'Invalid response from AI service' }, { status: 502 })
  }

  return NextResponse.json(result)
}
