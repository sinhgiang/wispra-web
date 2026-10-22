// TEMPORARY probe (not for merge). No key is used. Reports only HTTP status and the
// first bytes of Groq's answer. ?mode=nokey-get | nokey-post
export async function probeGroq(req: Request): Promise<Response> {
  const mode = new URL(req.url).searchParams.get('mode') ?? 'nokey-get'
  let status: number | string = 'error'
  let body = ''
  let headers: Record<string, string | null> = {}
  try {
    let r: Response
    if (mode === 'nokey-post') {
      const f = new FormData()
      f.set('model', 'whisper-large-v3-turbo')
      f.set('file', new Blob([new Uint8Array(100)], { type: 'audio/flac' }), 'a.flac')
      r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', { method: 'POST', body: f, signal: AbortSignal.timeout(8000) })
    } else {
      r = await fetch('https://api.groq.com/openai/v1/models', { signal: AbortSignal.timeout(8000) })
    }
    status = r.status
    body = (await r.text()).slice(0, 160)
    headers = { server: r.headers.get('server'), cfRay: r.headers.get('cf-ray') }
  } catch (e) {
    body = e instanceof Error ? e.message : 'fetch failed'
  }
  return Response.json({ mode, groqStatus: status, groqBody: body, headers, functionRegion: process.env.VERCEL_REGION ?? null })
}
