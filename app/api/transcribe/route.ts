import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, validateToken, currentMonth } from '@/lib/supabase-server'
import { getAccount } from '@/lib/account'
import { allowedTranscribeModel, billedSeconds, groqDurationSeconds, wavDurationSeconds } from '@/lib/transcription'
import { cleanGroqError } from '@/lib/groq-errors'
import { afterResponse } from '@/lib/after-response'
import { rateLimitedResponse, takeApiCall } from '@/lib/api-call-limits'

const FREE_LIMIT_SECONDS = 30 * 60 // 30 minutes

/**
 * One line per transcription in the server log, so the wait after "stop" can be
 * split into its parts (T-0249): reading the upload, the database, Groq, and the
 * whole request. Sizes and times only: never the audio, the text or the user.
 */
function logTranscription(line: Record<string, unknown>): void {
  const text = `[transcribe] ${JSON.stringify(line)}`
  if (typeof line.status === 'number' && line.status < 400) console.info(text)
  else console.error(text)
}

export async function POST(req: NextRequest) {
  const started = Date.now()
  const since = (from: number) => Date.now() - from

  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const token = authHeader.slice(7)
  const userId = await validateToken(token)
  if (!userId) {
    return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 })
  }
  const authMs = since(started)

  const supabase = createAdminClient()

  // Calls per minute and per day: counted while the upload comes in, so the
  // count adds no wait, and settled before anything else is checked or sent.
  const callTaken = takeApiCall(supabase, userId, 'transcribe')

  // The audio comes as multipart form data with a `file` field, as for Groq.
  const bodyStarted = Date.now()
  let form: FormData | null = null
  try {
    form = await req.formData()
  } catch { /* answered below, once the call is counted */ }
  const bodyMs = since(bodyStarted)

  const call = await callTaken
  if (!call.allowed) return rateLimitedResponse('transcribe', call)

  const file = form?.get('file')
  if (!form || !(file instanceof Blob)) {
    return NextResponse.json({ error: 'Send multipart/form-data with a "file" field' }, { status: 400 })
  }

  const month = currentMonth()

  // Plan and this month's seconds are read together: one database round trip
  // of waiting instead of two.
  const dbStarted = Date.now()
  const [{ plan, unlimited }, { data: usage }] = await Promise.all([
    getAccount(supabase, userId),
    supabase.from('usage').select('seconds_used').eq('user_id', userId).eq('month', month).maybeSingle(),
  ])
  const dbMs = since(dbStarted)

  // Enforce free-tier limit (accounts marked unlimited are exempt)
  if (plan === 'free' && !unlimited) {
    const secondsUsed = (usage as { seconds_used?: number } | null)?.seconds_used ?? 0
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
  const model = allowedTranscribeModel(form.get('model'))
  const outgoing = new FormData()
  for (const [name, value] of form.entries()) {
    if (name === 'model' || name === 'response_format') continue
    outgoing.append(name, value)
  }
  outgoing.set('model', model)
  outgoing.set('response_format', 'verbose_json')

  const log = { model, audioBytes: file.size, audioType: file.type || null }
  const groqStarted = Date.now()
  let groqResponse: Response
  try {
    groqResponse = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      body: outgoing,
      signal: AbortSignal.timeout(30_000),
    })
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'TimeoutError'
    logTranscription({ ...log, status: timedOut ? 'timeout' : 'network-error', ms: { auth: authMs, body: bodyMs, db: dbMs, groq: since(groqStarted), total: since(started) } })
    const msg = timedOut ? 'Transcription timed out' : 'Network error contacting transcription service'
    return NextResponse.json({ error: msg }, { status: 503 })
  }

  if (!groqResponse.ok) {
    const text = await groqResponse.text()
    logTranscription({ ...log, status: groqResponse.status, ms: { auth: authMs, body: bodyMs, db: dbMs, groq: since(groqStarted), total: since(started) } })
    return NextResponse.json({ error: cleanGroqError(text) }, { status: groqResponse.status })
  }

  const result = await groqResponse.json() as { text?: string; x_groq?: unknown }
  const groqMs = since(groqStarted)

  // Seconds are measured here. The client's x-audio-duration-seconds header is
  // used only when the server cannot measure the audio itself.
  const seconds = billedSeconds({
    groq: groqDurationSeconds(result),
    wav: wavDurationSeconds(new Uint8Array(await file.arrayBuffer())),
    clientHeader: req.headers.get('x-audio-duration-seconds'),
    fileBytes: file.size,
  })

  // Recorded after the answer has gone out, so the user does not wait for it
  // (best-effort, as before: a failed write does not fail the transcription).
  const totalMs = since(started)
  await afterResponse(async () => {
    const recordStarted = Date.now()
    let recorded = true
    try {
      const { error } = await supabase.rpc('increment_usage', { p_user_id: userId, p_month: month, p_seconds: seconds })
      if (error) recorded = false
    } catch {
      recorded = false
    }
    logTranscription({
      ...log,
      status: 200,
      seconds,
      ms: { auth: authMs, body: bodyMs, db: dbMs, groq: groqMs, total: totalMs, recordAfter: since(recordStarted) },
      ...(recorded ? {} : { recorded: false }),
    })
  })

  // A client that asked for plain json gets what Groq's json format returns.
  if (!wantsVerbose) {
    return NextResponse.json({ text: result.text, ...(result.x_groq !== undefined ? { x_groq: result.x_groq } : {}) })
  }
  return NextResponse.json(result)
}
