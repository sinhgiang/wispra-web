import { NextRequest, NextResponse } from 'next/server'
import { validateToken } from '@/lib/supabase-server'

const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions'

// Whitelist of Groq models the Electron client is allowed to request
const ALLOWED_MODELS = new Set([
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
  'llama3-70b-8192',
  'llama3-8b-8192',
  'mixtral-8x7b-32768',
  'gemma2-9b-it',
])

const DEFAULT_MODEL = 'llama-3.3-70b-versatile'

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

  // ── Forward to Groq ─────────────────────────────────────────────────────────
  let groqResponse: Response
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
  } catch (err) {
    const msg =
      err instanceof Error && err.name === 'TimeoutError'
        ? 'AI request timed out'
        : 'Network error contacting AI service'
    return NextResponse.json({ error: msg }, { status: 503 })
  }

  if (!groqResponse.ok) {
    const text = await groqResponse.text()
    return NextResponse.json({ error: text }, { status: groqResponse.status })
  }

  const result = await groqResponse.json()
  return NextResponse.json(result)
}
