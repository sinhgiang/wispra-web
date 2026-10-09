import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { PGlite } from '@electric-sql/pglite'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createProductionLikeDb, fakeSupabase, queryAs } from './helpers/test-db'
import {
  billedSeconds,
  FALLBACK_TRANSCRIBE_MODEL,
  groqDurationSeconds,
  shouldTryFallbackModel,
  TRANSCRIBE_MODEL,
  wavDurationSeconds,
} from '@/lib/transcription'

const FREE_USER = '00000000-0000-4000-8000-0000000000f1'
const TOKENS: Record<string, string> = { 'free-token': FREE_USER }

const state = vi.hoisted(() => ({ supabase: null as unknown }))

vi.mock('@/lib/supabase-server', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/supabase-server')>()),
  createAdminClient: () => state.supabase as SupabaseClient,
  validateToken: async (token: string) => TOKENS[token] ?? null,
}))

import { POST as transcribe } from '@/app/api/transcribe/route'

/** A silent 16 kHz, 16-bit mono PCM WAV of `seconds` seconds (header size can be overridden). */
function wav(seconds: number, { dataSizeInHeader }: { dataSizeInHeader?: number } = {}): Uint8Array {
  const byteRate = 16_000 * 2
  const dataBytes = Math.round(seconds * byteRate)
  const bytes = new Uint8Array(44 + dataBytes)
  const view = new DataView(bytes.buffer)
  const put = (at: number, text: string) => [...text].forEach((c, i) => (bytes[at + i] = c.charCodeAt(0)))
  put(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  put(8, 'WAVE')
  put(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, 16_000, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  put(36, 'data')
  view.setUint32(40, dataSizeInHeader ?? dataBytes, true)
  return bytes
}

describe('measuring a transcription', () => {
  it('reads the length of a WAV file from its header', () => {
    expect(wavDurationSeconds(wav(12))).toBeCloseTo(12, 5)
    expect(wavDurationSeconds(wav(0.5))).toBeCloseTo(0.5, 5)
  })

  it('counts only the bytes present when the header claims more (recording cut short)', () => {
    expect(wavDurationSeconds(wav(3, { dataSizeInHeader: 0xffffffff }))).toBeCloseTo(3, 5)
  })

  it('is null for anything that is not a WAV file', () => {
    expect(wavDurationSeconds(new TextEncoder().encode('....ftypM4A not a wav'))).toBeNull()
    expect(wavDurationSeconds(new Uint8Array(0))).toBeNull()
  })

  it('takes Groq’s duration, or where its last segment ends', () => {
    expect(groqDurationSeconds({ text: 'x', duration: 61.2 })).toBe(61.2)
    expect(groqDurationSeconds({ text: 'x', segments: [{ end: 4.5 }, { end: 42.3 }] })).toBe(42.3)
    expect(groqDurationSeconds({ text: 'x', duration: 10, segments: [{ end: 12 }] })).toBe(12)
    expect(groqDurationSeconds({ text: 'x' })).toBeNull()
    expect(groqDurationSeconds(null)).toBeNull()
  })

  it('bills the server’s own measure over the client’s claim, at least 1 second', () => {
    expect(billedSeconds({ groq: 60, wav: null, clientHeader: '1', fileBytes: 10 })).toBe(60)
    expect(billedSeconds({ groq: 40.2, wav: 41.5, clientHeader: null, fileBytes: 10 })).toBe(42)
    expect(billedSeconds({ groq: null, wav: null, clientHeader: '7.1', fileBytes: 10 })).toBe(8)
    expect(billedSeconds({ groq: null, wav: null, clientHeader: 'nonsense', fileBytes: 480_000 })).toBe(30)
    expect(billedSeconds({ groq: null, wav: null, clientHeader: '-5', fileBytes: 0 })).toBe(1)
  })

  it('uses turbo, with v3 as the other model', () => {
    expect(TRANSCRIBE_MODEL).toBe('whisper-large-v3-turbo')
    expect(FALLBACK_TRANSCRIBE_MODEL).toBe('whisper-large-v3')
  })

  it('asks the other model only for failures it can help with', () => {
    for (const status of [404, 429, 500, 502, 503, 529]) expect(shouldTryFallbackModel(status), String(status)).toBe(true)
    for (const status of [400, 401, 402, 403, 413, 422]) expect(shouldTryFallbackModel(status), String(status)).toBe(false)
  })
})

describe('POST /api/transcribe', () => {
  let pg: PGlite
  const fetchMock = vi.fn()

  const secondsUsed = async () => {
    const res = await pg.query<{ seconds_used: number }>('SELECT seconds_used FROM public.usage WHERE user_id = $1', [FREE_USER])
    return res.rows[0]?.seconds_used ?? 0
  }

  const request = (
    file: Uint8Array | null,
    fields: Record<string, string> = {},
    headers: Record<string, string> = {},
    token = 'free-token'
  ) => {
    const form = new FormData()
    if (file) form.append('file', new Blob([new Uint8Array(file)], { type: 'audio/wav' }), 'audio.wav')
    for (const [k, v] of Object.entries(fields)) form.append(k, v)
    return transcribe(
      new NextRequest('http://localhost/api/transcribe', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, ...headers },
        body: form,
      })
    )
  }

  const groqVerbose = (body: Record<string, unknown>) =>
    new Response(JSON.stringify({ text: 'Hello there.', x_groq: { id: 'req_1' }, ...body }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })

  beforeAll(async () => {
    pg = await createProductionLikeDb([
      '002_sync.sql',
      '003_mcp_tokens.sql',
      '004_mcp_token_expiry.sql',
      '005_ai_token_usage.sql',
      '006_lock_increment_usage.sql',
      '007_unlimited_accounts.sql',
    ])
    await queryAs(pg, 'supabase_auth_admin', 'INSERT INTO auth.users (id) VALUES ($1)', [FREE_USER])
  })
  afterAll(() => pg.close())

  beforeEach(async () => {
    state.supabase = fakeSupabase(pg)
    await pg.exec('DELETE FROM public.usage')
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('counts the minutes even when the app sends no duration header (the bypass)', async () => {
    fetchMock.mockResolvedValueOnce(groqVerbose({ segments: [{ end: 11.8 }] }))

    const res = await request(wav(12))

    expect(res.status).toBe(200)
    expect(await secondsUsed()).toBe(12)
  })

  it('counts what the server measured, not a smaller number the app claims', async () => {
    fetchMock.mockResolvedValueOnce(groqVerbose({ duration: 95.4 }))

    await request(wav(95), {}, { 'x-audio-duration-seconds': '1' })

    expect(await secondsUsed()).toBe(96)
  })

  it('measures a non-WAV file by Groq’s answer', async () => {
    fetchMock.mockResolvedValueOnce(groqVerbose({ segments: [{ end: 3 }, { end: 42.3 }] }))

    await request(new TextEncoder().encode('....ftypM4A compressed audio'))

    expect(await secondsUsed()).toBe(43)
  })

  it('refuses a Free user who has used 30 minutes, without calling Groq', async () => {
    await pg.query("INSERT INTO public.usage (user_id, month, seconds_used) VALUES ($1, to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM'), 1800)", [FREE_USER])

    const res = await request(wav(5))

    expect(res.status).toBe(402)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends Groq turbo whatever model the app asks for, with verbose_json, and passes the other fields on', async () => {
    fetchMock.mockImplementation(async () => groqVerbose({ duration: 2 }))

    await request(wav(2), { model: 'some-expensive-model', response_format: 'text', language: 'vi', prompt: 'Wispra' })
    await request(wav(2), { model: 'whisper-large-v3' })
    await request(wav(2))

    const first = fetchMock.mock.calls[0][1].body as FormData
    expect(first.get('model')).toBe('whisper-large-v3-turbo')
    expect(first.get('response_format')).toBe('verbose_json')
    expect(first.get('language')).toBe('vi')
    expect(first.get('prompt')).toBe('Wispra')
    expect(first.getAll('model')).toHaveLength(1)
    expect((first.get('file') as Blob).size).toBe(wav(2).length)
    // The installed desktop app asks for whisper-large-v3: it still gets turbo.
    expect((fetchMock.mock.calls[1][1].body as FormData).get('model')).toBe('whisper-large-v3-turbo')
    expect((fetchMock.mock.calls[2][1].body as FormData).get('model')).toBe('whisper-large-v3-turbo')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  describe('when turbo fails', () => {
    const modelOf = (call: number) => (fetchMock.mock.calls[call][1].body as FormData).get('model')
    const groqError = (status: number) => new Response(JSON.stringify({ error: { message: 'nope' } }), { status })
    const lines = (spy: unknown) => (spy as { mock: { calls: unknown[][] } }).mock.calls.map(c => String(c[0]))
    let info: unknown
    let error: unknown

    beforeEach(() => {
      info = vi.spyOn(console, 'info').mockImplementation(() => {})
      error = vi.spyOn(console, 'error').mockImplementation(() => {})
    })
    afterEach(() => vi.restoreAllMocks())

    it.each([429, 500, 503, 404])('asks v3 once after turbo answers %i, and answers with its text and minutes', async status => {
      fetchMock.mockResolvedValueOnce(groqError(status)).mockResolvedValueOnce(groqVerbose({ text: 'From v3.', duration: 7 }))

      const res = await request(wav(7), { language: 'vi', model: 'whisper-large-v3' })

      expect(res.status).toBe(200)
      expect((await res.json()).text).toBe('From v3.')
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(modelOf(0)).toBe('whisper-large-v3-turbo')
      expect(modelOf(1)).toBe('whisper-large-v3')
      expect((fetchMock.mock.calls[1][1].body as FormData).get('language')).toBe('vi')
      expect(((fetchMock.mock.calls[1][1].body as FormData).get('file') as Blob).size).toBe(wav(7).length)
      expect(await secondsUsed()).toBe(7)
      expect(
        lines(error).some(l => l.includes('"model":"whisper-large-v3-turbo"') && l.includes(`"status":${status}`) && l.includes('"retryWith":"whisper-large-v3"'))
      ).toBe(true)
    })

    it('asks v3 after a network error or a timeout of turbo', async () => {
      fetchMock
        .mockRejectedValueOnce(Object.assign(new Error('timed out'), { name: 'TimeoutError' }))
        .mockResolvedValueOnce(groqVerbose({ duration: 2 }))
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockResolvedValueOnce(groqVerbose({ duration: 2 }))

      expect((await request(wav(2))).status).toBe(200)
      expect((await request(wav(2))).status).toBe(200)

      expect(fetchMock.mock.calls.map((_, i) => modelOf(i))).toEqual([
        'whisper-large-v3-turbo',
        'whisper-large-v3',
        'whisper-large-v3-turbo',
        'whisper-large-v3',
      ])
    })

    it('does not ask v3 after an answer it would give too: a bad file, a file that is too large', async () => {
      for (const status of [400, 413]) {
        fetchMock.mockReset()
        fetchMock.mockResolvedValue(groqError(status))
        const res = await request(wav(2))
        expect(res.status).toBe(status)
        expect(fetchMock).toHaveBeenCalledTimes(1)
      }
      expect(await secondsUsed()).toBe(0)
    })

    it('when v3 fails too, answers its error once and records nothing', async () => {
      fetchMock.mockResolvedValueOnce(groqError(503)).mockResolvedValueOnce(groqError(429))

      const res = await request(wav(2))

      expect(res.status).toBe(429)
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(await secondsUsed()).toBe(0)
      expect(
        lines(error).some(
          l => l.includes('"model":"whisper-large-v3"') && l.includes('"status":429') && l.includes('"fellBackFrom":{"model":"whisper-large-v3-turbo","status":503}')
        )
      ).toBe(true)
    })

    it('when v3 times out too, answers 503 and records nothing', async () => {
      fetchMock
        .mockResolvedValueOnce(groqError(500))
        .mockRejectedValueOnce(Object.assign(new Error('timed out'), { name: 'TimeoutError' }))

      const res = await request(wav(2))

      expect(res.status).toBe(503)
      expect(await res.json()).toEqual({ error: 'Transcription timed out' })
      expect(await secondsUsed()).toBe(0)
    })

    it('logs the model that answered, and where it came from', async () => {
      fetchMock.mockResolvedValueOnce(groqError(500)).mockResolvedValueOnce(groqVerbose({ duration: 2 }))

      await request(wav(2))
      await new Promise(resolve => setTimeout(resolve, 50))

      const ok = lines(info).find(l => l.startsWith('[transcribe]') && l.includes('"status":200'))
      expect(ok).toBeDefined()
      const data = JSON.parse(ok!.slice('[transcribe] '.length))
      expect(data).toMatchObject({ model: 'whisper-large-v3', fellBackFrom: { model: 'whisper-large-v3-turbo', status: 500 } })
    })
  })

  it('answers in the format the app asked for', async () => {
    fetchMock.mockImplementation(async () => groqVerbose({ duration: 2, segments: [{ end: 2, text: 'Hello there.' }] }))

    const plain = await (await request(wav(2))).json()
    expect(plain).toEqual({ text: 'Hello there.', x_groq: { id: 'req_1' } })

    const verbose = await (await request(wav(2), { response_format: 'verbose_json' })).json()
    expect(verbose.segments).toHaveLength(1)
    expect(verbose.duration).toBe(2)
  })

  it('records nothing when Groq fails', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"error":{"message":"bad audio"}}', { status: 400 }))

    const res = await request(wav(5))

    expect(res.status).toBe(400)
    expect(await secondsUsed()).toBe(0)
  })

  it('rejects a request without a file, or not multipart, before calling Groq', async () => {
    expect((await request(null, { language: 'vi' })).status).toBe(400)
    const notMultipart = await transcribe(
      new NextRequest('http://localhost/api/transcribe', {
        method: 'POST',
        headers: { authorization: 'Bearer free-token', 'content-type': 'application/json' },
        body: '{}',
      })
    )
    expect(notMultipart.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses a missing or invalid sign-in', async () => {
    expect((await request(wav(1), {}, {}, 'stolen-token')).status).toBe(401)
    const none = await transcribe(new NextRequest('http://localhost/api/transcribe', { method: 'POST', body: new FormData() }))
    expect(none.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
