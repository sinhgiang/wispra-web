import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, validateToken, currentMonth } from '@/lib/supabase-server'

const FREE_LIMIT_SECONDS = 30 * 60 // 30 minutes

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const token = authHeader.slice(7)
  const userId = await validateToken(token)
  if (!userId) {
    return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 })
  }

  const supabase = createAdminClient()

  // Check user plan
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('plan')
    .eq('user_id', userId)
    .single()

  const plan = sub?.plan ?? 'free'

  // Enforce free-tier limit
  if (plan === 'free') {
    const month = currentMonth()
    const { data: usage } = await supabase
      .from('usage')
      .select('seconds_used')
      .eq('user_id', userId)
      .eq('month', month)
      .single()

    const secondsUsed = usage?.seconds_used ?? 0
    if (secondsUsed >= FREE_LIMIT_SECONDS) {
      return NextResponse.json(
        { error: 'Monthly free tier limit reached (30 minutes). Upgrade to Pro for unlimited transcription.' },
        { status: 402 }
      )
    }
  }

  // Stream form data directly to Groq
  const contentType = req.headers.get('content-type') ?? ''
  const body = await req.arrayBuffer()

  let groqResponse: Response
  try {
    groqResponse = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': contentType,
      },
      body,
      signal: AbortSignal.timeout(30_000),
    })
  } catch (err) {
    const msg = err instanceof Error && err.name === 'TimeoutError'
      ? 'Transcription timed out'
      : 'Network error contacting transcription service'
    return NextResponse.json({ error: msg }, { status: 503 })
  }

  if (!groqResponse.ok) {
    const text = await groqResponse.text()
    return NextResponse.json({ error: text }, { status: groqResponse.status })
  }

  const result = await groqResponse.json() as { text?: string; language?: string }

  // Record usage (best-effort — do not fail the response if this errors)
  const durationHeader = req.headers.get('x-audio-duration-seconds')
  if (durationHeader) {
    const seconds = Math.max(1, Math.ceil(parseFloat(durationHeader)))
    const month = currentMonth()
    try {
      await supabase.rpc('increment_usage', { p_user_id: userId, p_month: month, p_seconds: seconds })
    } catch { /* non-fatal */ }
  }

  return NextResponse.json(result)
}
