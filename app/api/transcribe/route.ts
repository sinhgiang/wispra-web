import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, validateToken, currentMonth } from '@/lib/supabase-server'
import { getAccount } from '@/lib/account'
import { allowedTranscribeModel, billedSeconds, groqDurationSeconds, wavDurationSeconds } from '@/lib/transcription'
import { cleanGroqError } from '@/lib/groq-errors'

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

  // The audio comes as multipart form data with a `file` field, as for Groq.
  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Send multipart/form-data with a "file" field' }, { status: 400 })
  }
  const file = form.get('file')
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: 'Send multipart/form-data with a "file" field' }, { status: 400 })
  }

  const supabase = createAdminClient()

  // Check user plan
  const { plan, unlimited } = await getAccount(supabase, userId)

  // Enforce free-tier limit (accounts marked unlimited are exempt)
  if (plan === 'free' && !unlimited) {
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

  // Passed on to Groq as sent, except: the model must be one we allow, and the
  // answer is always verbose_json so the server can read how long the audio was.
  const asked = form.get('response_format')
  const wantsVerbose = asked === 'verbose_json'
  const outgoing = new FormData()
  for (const [name, value] of form.entries()) {
    if (name === 'model' || name === 'response_format') continue
    outgoing.append(name, value)
  }
  outgoing.set('model', allowedTranscribeModel(form.get('model')))
  outgoing.set('response_format', 'verbose_json')

  let groqResponse: Response
  try {
    groqResponse = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      body: outgoing,
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
    return NextResponse.json({ error: cleanGroqError(text) }, { status: groqResponse.status })
  }

  const result = await groqResponse.json() as { text?: string; x_groq?: unknown }

  // Record usage, measured here, before answering (best-effort — do not fail the
  // response if this errors). The client's x-audio-duration-seconds header is used
  // only when the server cannot measure the audio itself.
  const seconds = billedSeconds({
    groq: groqDurationSeconds(result),
    wav: wavDurationSeconds(new Uint8Array(await file.arrayBuffer())),
    clientHeader: req.headers.get('x-audio-duration-seconds'),
    fileBytes: file.size,
  })
  try {
    await supabase.rpc('increment_usage', { p_user_id: userId, p_month: currentMonth(), p_seconds: seconds })
  } catch { /* non-fatal */ }

  // A client that asked for plain json gets what Groq's json format returns.
  if (!wantsVerbose) {
    return NextResponse.json({ text: result.text, ...(result.x_groq !== undefined ? { x_groq: result.x_groq } : {}) })
  }
  return NextResponse.json(result)
}
