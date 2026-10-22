// TEMPORARY probe (not for merge): asks Groq for its model list WITHOUT any key.
// 401 = the network was let in; 403 "Access denied" = the network is blocked.
export async function probeGroq(req: Request): Promise<Response> {
  let status: number | string = 'error'
  let body = ''
  try {
    const r = await fetch('https://api.groq.com/openai/v1/models', { signal: AbortSignal.timeout(8000) })
    status = r.status
    body = (await r.text()).slice(0, 120)
  } catch (e) {
    body = e instanceof Error ? e.message : 'fetch failed'
  }
  return Response.json({
    groqStatus: status,
    groqBody: body,
    vercelId: req.headers.get('x-vercel-id'),
    envRegion: process.env.VERCEL_REGION ?? null,
  })
}
