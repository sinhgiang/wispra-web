import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { PGlite } from '@electric-sql/pglite'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createProductionLikeDb, fakeSupabase, queryAs } from './helpers/test-db'

// Bearer token → user id, standing in for Supabase auth.
const USER_A = '00000000-0000-4000-8000-0000000000a1'
const USER_B = '00000000-0000-4000-8000-0000000000b2'
const TOKENS: Record<string, string> = { 'a-token': USER_A, 'b-token': USER_B }

const state = vi.hoisted(() => ({ supabase: null as unknown }))

vi.mock('@/lib/supabase-server', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/supabase-server')>()),
  createAdminClient: () => state.supabase as SupabaseClient,
  validateToken: async (token: string) => TOKENS[token] ?? null,
}))

import { POST as transcribe } from '@/app/api/transcribe/route'
import { POST as chat } from '@/app/api/chat/completions/route'
import { API_CALL_LIMITS, takeApiCall, waitText } from '@/lib/api-call-limits'

const MIGRATIONS = [
  '002_sync.sql',
  '003_mcp_tokens.sql',
  '004_mcp_token_expiry.sql',
  '005_ai_token_usage.sql',
  '006_lock_increment_usage.sql',
  '007_unlimited_accounts.sql',
]

/** A silent 16 kHz, 16-bit mono PCM WAV of `seconds` seconds. */
function wav(seconds: number): Uint8Array {
  const dataBytes = Math.round(seconds * 32_000)
  const bytes = new Uint8Array(44 + dataBytes)
  const view = new DataView(bytes.buffer)
  const put = (at: number, text: string) => [...text].forEach((c, i) => (bytes[at + i] = c.charCodeAt(0)))
  put(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  put(8, 'WAVE')
  put(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, 16_000, true)
  view.setUint32(28, 32_000, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  put(36, 'data')
  view.setUint32(40, dataBytes, true)
  return bytes
}

const transcribeRequest = (token: string) => {
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(wav(2))], { type: 'audio/wav' }), 'audio.wav')
  return transcribe(
    new NextRequest('http://localhost/api/transcribe', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: form,
    })
  )
}

const chatRequest = (token: string) =>
  chat(
    new NextRequest('http://localhost/api/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Clean up this text.' }] }),
    })
  )

const groqTranscription = () =>
  new Response(JSON.stringify({ text: 'Hello there.', duration: 2 }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

const groqChat = () =>
  new Response(
    JSON.stringify({
      choices: [{ message: { role: 'assistant', content: 'Cleaned text.' } }],
      usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  )

/**
 * The windows follow the database clock, so a test that fills a minute must not
 * cross into the next one halfway: wait until the minute has room left.
 */
async function awayFromMinuteEdge(): Promise<void> {
  while (new Date().getUTCSeconds() > 50 || new Date().getUTCSeconds() < 1) {
    await new Promise(resolve => setTimeout(resolve, 500))
  }
}

async function calls(pg: PGlite, userId: string, route: string, period: string): Promise<number | null> {
  const res = await pg.query<{ calls: number }>(
    'SELECT calls FROM public.api_call_counts WHERE user_id = $1 AND route = $2 AND period = $3',
    [userId, route, period]
  )
  return res.rows[0]?.calls ?? null
}

/** Sets a user's count in the current window, as if they had already made that many calls. */
async function setCalls(pg: PGlite, userId: string, route: string, period: 'minute' | 'day', n: number) {
  const start = period === 'minute' ? "date_trunc('minute', now())" : "date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'"
  await pg.query(
    `INSERT INTO public.api_call_counts (user_id, route, period, window_start, calls) VALUES ($1, $2, $3, ${start}, $4)
     ON CONFLICT (user_id, route, period) DO UPDATE SET window_start = EXCLUDED.window_start, calls = EXCLUDED.calls`,
    [userId, route, period, n]
  )
}

describe('migration 010: api_call_counts and take_api_call', () => {
  let pg: PGlite

  beforeAll(async () => {
    pg = await createProductionLikeDb([...MIGRATIONS, '010_api_call_limits.sql'])
    await queryAs(pg, 'supabase_auth_admin', 'INSERT INTO auth.users (id) VALUES ($1), ($2)', [USER_A, USER_B])
  })
  afterAll(() => pg.close())
  beforeEach(async () => {
    await pg.exec('DELETE FROM public.api_call_counts')
    await awayFromMinuteEdge()
  })

  const take = (userId: string, route = 'transcribe', perMinute = 3, perDay = 10) =>
    pg
      .query<{ r: { allowed: boolean; period?: string; limit?: number; retry_after?: number } }>(
        'SELECT public.take_api_call($1, $2, $3, $4) AS r',
        [userId, route, perMinute, perDay]
      )
      .then(res => res.rows[0].r)

  it('only adds: a new table and a new function, nothing dropped, deleted or altered', async () => {
    const sql = (await import('node:fs')).readFileSync(
      (await import('node:path')).join(__dirname, '..', 'supabase', 'migrations', '010_api_call_limits.sql'),
      'utf8'
    )
    // Statements only, not the comments that explain how to undo it.
    const statements = sql.replace(/--.*$/gm, '')
    expect(statements).not.toMatch(/\b(DROP|TRUNCATE)\b|(?<!ON )\bDELETE\b/i)
    expect(statements).toMatch(/ON DELETE CASCADE/) // the foreign key, not a delete
    expect(statements).not.toMatch(/ALTER TABLE (?!public\.api_call_counts ENABLE ROW LEVEL SECURITY)/i)
    expect(statements.match(/CREATE TABLE/gi)).toHaveLength(1)
  })

  it('has RLS on, and anon or a signed-in user can neither read nor write the counts', async () => {
    const rls = await pg.query<{ relrowsecurity: boolean }>(
      "SELECT relrowsecurity FROM pg_class WHERE oid = 'public.api_call_counts'::regclass"
    )
    expect(rls.rows[0].relrowsecurity).toBe(true)

    await take(USER_A)
    for (const role of ['anon', 'authenticated']) {
      await expect(queryAs(pg, role, 'SELECT * FROM public.api_call_counts')).rejects.toThrow(/permission denied/)
      await expect(
        queryAs(pg, role, "UPDATE public.api_call_counts SET calls = 0 WHERE route = 'transcribe'")
      ).rejects.toThrow(/permission denied/)
      await expect(
        queryAs(pg, role, "SELECT public.take_api_call($1, 'transcribe', 1, 1)", [USER_B])
      ).rejects.toThrow(/permission denied/)
    }
    const asServer = await queryAs<{ r: { allowed: boolean } }>(
      pg, 'service_role', "SELECT public.take_api_call($1, 'transcribe', 1, 1) AS r", [USER_B]
    )
    expect(asServer.rows[0].r.allowed).toBe(true)
  })

  it('lets calls in up to the limit per minute, then refuses until the next minute, without counting refusals', async () => {
    expect((await take(USER_A)).allowed).toBe(true)
    expect((await take(USER_A)).allowed).toBe(true)
    expect((await take(USER_A)).allowed).toBe(true)

    const refused = await take(USER_A)
    expect(refused).toMatchObject({ allowed: false, period: 'minute', limit: 3 })
    expect(refused.retry_after).toBeGreaterThanOrEqual(1)
    expect(refused.retry_after).toBeLessThanOrEqual(60)
    expect((await take(USER_A)).allowed).toBe(false)
    expect(await calls(pg, USER_A, 'transcribe', 'minute')).toBe(3)
    expect(await calls(pg, USER_A, 'transcribe', 'day')).toBe(3)

    // The minute passes: the same row starts again at 1, the day keeps counting.
    await pg.query("UPDATE public.api_call_counts SET window_start = window_start - interval '1 minute' WHERE period = 'minute'")
    expect((await take(USER_A)).allowed).toBe(true)
    expect(await calls(pg, USER_A, 'transcribe', 'minute')).toBe(1)
    expect(await calls(pg, USER_A, 'transcribe', 'day')).toBe(4)
  })

  it('refuses for the rest of the day once the daily limit is reached, and resets the next day', async () => {
    await setCalls(pg, USER_A, 'transcribe', 'day', 10)

    const refused = await take(USER_A)
    expect(refused).toMatchObject({ allowed: false, period: 'day', limit: 10 })
    expect(refused.retry_after).toBeGreaterThan(0)
    expect(refused.retry_after).toBeLessThanOrEqual(86_400)

    await pg.query("UPDATE public.api_call_counts SET window_start = window_start - interval '1 day' WHERE period = 'day'")
    expect((await take(USER_A)).allowed).toBe(true)
    expect(await calls(pg, USER_A, 'transcribe', 'day')).toBe(1)
  })

  it('counts each user and each route on its own (user B is not blocked by user A)', async () => {
    for (let i = 0; i < 3; i++) await take(USER_A)
    expect((await take(USER_A)).allowed).toBe(false)

    expect((await take(USER_B)).allowed).toBe(true)
    expect((await take(USER_A, 'chat')).allowed).toBe(true)
    expect(await calls(pg, USER_B, 'transcribe', 'minute')).toBe(1)
  })

  it('never lets more calls in than the limit when they arrive together', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => take(USER_A)))
    expect(results.filter(r => r.allowed)).toHaveLength(3)
    expect(await calls(pg, USER_A, 'transcribe', 'minute')).toBe(3)
  })

  it('refuses a route it does not know and limits below 1', async () => {
    await expect(take(USER_A, 'mcp')).rejects.toThrow()
    await expect(take(USER_A, 'transcribe', 0, 10)).rejects.toThrow(/at least 1/)
  })

  it('keeps at most two rows per user and route, however long it runs', async () => {
    for (let day = 0; day < 5; day++) {
      await take(USER_A)
      await pg.query("UPDATE public.api_call_counts SET window_start = window_start - interval '1 day'")
    }
    const rows = await pg.query('SELECT 1 FROM public.api_call_counts WHERE user_id = $1', [USER_A])
    expect(rows.rows).toHaveLength(2)
  })
})

describe('call limits on /api/transcribe and /api/chat/completions', () => {
  let pg: PGlite
  const fetchMock = vi.fn()

  beforeAll(async () => {
    pg = await createProductionLikeDb([...MIGRATIONS, '010_api_call_limits.sql'])
    await queryAs(pg, 'supabase_auth_admin', 'INSERT INTO auth.users (id) VALUES ($1), ($2)', [USER_A, USER_B])
  })
  afterAll(() => pg.close())

  beforeEach(async () => {
    state.supabase = fakeSupabase(pg)
    await pg.exec('DELETE FROM public.api_call_counts; DELETE FROM public.usage; DELETE FROM public.ai_token_usage')
    fetchMock.mockReset()
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes('/audio/transcriptions') ? groqTranscription() : groqChat()
    )
    vi.stubGlobal('fetch', fetchMock)
    await awayFromMinuteEdge()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('has limits far above what a person does by hand', () => {
    // A 30-minute dictation is 60 parts of 30 seconds; a working day of meetings
    // (8 hours) is 960 parts.
    expect(API_CALL_LIMITS.transcribe.perMinute).toBeGreaterThanOrEqual(60)
    expect(API_CALL_LIMITS.transcribe.perDay).toBeGreaterThanOrEqual(2 * 960)
    expect(API_CALL_LIMITS.chat.perMinute).toBeGreaterThanOrEqual(60)
    expect(API_CALL_LIMITS.chat.perDay).toBeGreaterThanOrEqual(3_000)
  })

  it('lets a long dictation through: every part in the same minute up to the limit answers 200', async () => {
    const { perMinute } = API_CALL_LIMITS.transcribe
    for (let i = 0; i < perMinute; i++) {
      const res = await transcribeRequest('a-token')
      expect(res.status).toBe(200)
    }
    expect(fetchMock).toHaveBeenCalledTimes(perMinute)
    expect(await calls(pg, USER_A, 'transcribe', 'minute')).toBe(perMinute)
  })

  it('answers 429 with Retry-After past the per-minute limit, without calling Groq', async () => {
    await setCalls(pg, USER_A, 'transcribe', 'minute', API_CALL_LIMITS.transcribe.perMinute)

    const res = await transcribeRequest('a-token')
    const body = await res.json()

    expect(res.status).toBe(429)
    expect(fetchMock).not.toHaveBeenCalled()
    const retryAfter = Number(res.headers.get('retry-after'))
    expect(retryAfter).toBeGreaterThanOrEqual(1)
    expect(retryAfter).toBeLessThanOrEqual(60)
    expect(body).toMatchObject({ code: 'rate_limited', period: 'minute', limit: 60, retryAfter })
    // Worded like Groq's per-minute errors, so the desktop app waits and sends again.
    expect(body.error).toMatch(/requests per minute/)
    expect(body.error).not.toMatch(/per (hour|day)/)
    expect(body.error).toContain(`try again in ${retryAfter}s`)
  })

  it('answers 429 past the daily limit, saying when it resets', async () => {
    await setCalls(pg, USER_A, 'transcribe', 'day', API_CALL_LIMITS.transcribe.perDay)

    const res = await transcribeRequest('a-token')
    const body = await res.json()

    expect(res.status).toBe(429)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(body).toMatchObject({ code: 'rate_limited', period: 'day', limit: 2_000 })
    expect(body.error).toMatch(/requests per day/)
    expect(body.error).toContain('00:00 UTC')
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(60)
  })

  it('does not block user B when user A is over the limit', async () => {
    await setCalls(pg, USER_A, 'transcribe', 'minute', API_CALL_LIMITS.transcribe.perMinute)
    await setCalls(pg, USER_A, 'chat', 'minute', API_CALL_LIMITS.chat.perMinute)

    expect((await transcribeRequest('a-token')).status).toBe(429)
    expect((await transcribeRequest('b-token')).status).toBe(200)
    expect((await chatRequest('a-token')).status).toBe(429)
    expect((await chatRequest('b-token')).status).toBe(200)
  })

  it('lets an unlimited account past the per-minute and daily limits; a normal account still gets 429', async () => {
    await pg.query('UPDATE public.subscriptions SET unlimited = true WHERE user_id = $1', [USER_A])
    try {
      for (const user of [USER_A, USER_B]) {
        await setCalls(pg, user, 'transcribe', 'minute', API_CALL_LIMITS.transcribe.perMinute)
        await setCalls(pg, user, 'transcribe', 'day', API_CALL_LIMITS.transcribe.perDay)
        await setCalls(pg, user, 'chat', 'minute', API_CALL_LIMITS.chat.perMinute)
        await setCalls(pg, user, 'chat', 'day', API_CALL_LIMITS.chat.perDay)
      }

      for (let i = 0; i < 3; i++) {
        expect((await transcribeRequest('a-token')).status).toBe(200)
        expect((await chatRequest('a-token')).status).toBe(200)
      }
      expect(fetchMock).toHaveBeenCalledTimes(6)

      const refusedTranscribe = await transcribeRequest('b-token')
      expect(refusedTranscribe.status).toBe(429)
      expect((await refusedTranscribe.json()).code).toBe('rate_limited')
      const refusedChat = await chatRequest('b-token')
      expect(refusedChat.status).toBe(429)
      expect((await refusedChat.json()).code).toBe('rate_limited')
      expect(fetchMock).toHaveBeenCalledTimes(6)
    } finally {
      await pg.query('UPDATE public.subscriptions SET unlimited = false WHERE user_id = $1', [USER_A])
    }
  })

  it('reads the unlimited flag only for a call over the limit', async () => {
    const client = fakeSupabase(pg)
    const from = vi.spyOn(client, 'from')
    state.supabase = client

    expect((await transcribeRequest('b-token')).status).toBe(200)
    // Under the limit: the route reads subscriptions once for the monthly minutes, the counter not at all.
    expect(from.mock.calls.filter(([table]) => table === 'subscriptions')).toHaveLength(1)

    from.mockClear()
    expect(await takeApiCall(client, USER_B, 'chat')).toEqual({ allowed: true })
    expect(from).not.toHaveBeenCalled()

    await setCalls(pg, USER_B, 'chat', 'minute', API_CALL_LIMITS.chat.perMinute)
    expect((await takeApiCall(client, USER_B, 'chat')).allowed).toBe(false)
    expect(from.mock.calls.map(([table]) => table)).toEqual(['subscriptions'])
  })

  it('counts transcription and AI apart: a user over the transcription limit can still use AI', async () => {
    await setCalls(pg, USER_A, 'transcribe', 'minute', API_CALL_LIMITS.transcribe.perMinute)

    const res = await chatRequest('a-token')

    expect(res.status).toBe(200)
    expect((await res.json()).choices[0].message.content).toBe('Cleaned text.')
  })

  it('answers 429 on /api/chat/completions past its limit, without calling Groq or counting tokens', async () => {
    await setCalls(pg, USER_A, 'chat', 'minute', API_CALL_LIMITS.chat.perMinute)

    const res = await chatRequest('a-token')
    const body = await res.json()

    expect(res.status).toBe(429)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(body).toMatchObject({ code: 'rate_limited', period: 'minute' })
    expect(body.error).toMatch(/^Rate limit reached for AI requests per minute/)
    expect((await pg.query('SELECT 1 FROM public.ai_token_usage')).rows).toHaveLength(0)
  })

  it('counts one call per request, also when the server asks the backup model', async () => {
    fetchMock.mockReset()
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'Rate limit reached on tokens per day (TPD)' } }), { status: 429 })
      )
      .mockResolvedValueOnce(groqChat())

    expect((await chatRequest('a-token')).status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(await calls(pg, USER_A, 'chat', 'minute')).toBe(1)
  })

  it('counts a malformed request too, and still answers it 400 while under the limit', async () => {
    const badChat = () =>
      chat(
        new NextRequest('http://localhost/api/chat/completions', {
          method: 'POST',
          headers: { authorization: 'Bearer a-token', 'content-type': 'application/json' },
          body: 'not json',
        })
      )
    const badTranscribe = () =>
      transcribe(
        new NextRequest('http://localhost/api/transcribe', {
          method: 'POST',
          headers: { authorization: 'Bearer a-token', 'content-type': 'text/plain' },
          body: 'not a form',
        })
      )

    expect((await badChat()).status).toBe(400)
    expect((await badTranscribe()).status).toBe(400)
    expect(await calls(pg, USER_A, 'chat', 'minute')).toBe(1)
    expect(await calls(pg, USER_A, 'transcribe', 'minute')).toBe(1)

    await setCalls(pg, USER_A, 'chat', 'minute', API_CALL_LIMITS.chat.perMinute)
    await setCalls(pg, USER_A, 'transcribe', 'minute', API_CALL_LIMITS.transcribe.perMinute)
    expect((await badChat()).status).toBe(429)
    expect((await badTranscribe()).status).toBe(429)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not count a request without a valid sign-in', async () => {
    expect((await transcribeRequest('wrong-token')).status).toBe(401)
    expect((await pg.query('SELECT 1 FROM public.api_call_counts')).rows).toHaveLength(0)
  })
})

describe('before migration 010 is applied', () => {
  let pg: PGlite
  const fetchMock = vi.fn()

  beforeAll(async () => {
    pg = await createProductionLikeDb(MIGRATIONS)
    await queryAs(pg, 'supabase_auth_admin', 'INSERT INTO auth.users (id) VALUES ($1)', [USER_A])
    state.supabase = fakeSupabase(pg)
  })
  afterAll(() => pg.close())
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('lets every call through and logs why', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes('/audio/transcriptions') ? groqTranscription() : groqChat()
    )
    vi.stubGlobal('fetch', fetchMock)

    expect((await transcribeRequest('a-token')).status).toBe(200)
    expect((await chatRequest('a-token')).status).toBe(200)
    expect(logged.mock.calls.some(c => String(c[0]).startsWith('[rate-limit]'))).toBe(true)
  })
})

describe('takeApiCall', () => {
  it('allows the call when the database throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken = { rpc: async () => { throw new Error('connection reset') } } as unknown as SupabaseClient
    expect(await takeApiCall(broken, USER_A, 'chat')).toEqual({ allowed: true })
    vi.restoreAllMocks()
  })

  it('writes waits the way the apps read them', () => {
    expect(waitText(7)).toBe('7s')
    expect(waitText(60)).toBe('1m0s')
    expect(waitText(5 * 3600 + 3 * 60 + 2)).toBe('5h3m2s')
    expect(waitText(3600)).toBe('1h0m0s')
  })
})
