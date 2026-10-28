import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { PGlite } from '@electric-sql/pglite'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createProductionLikeDb, fakeSupabase, queryAs } from './helpers/test-db'
import { allowedLanguages, guessedOutsideSet, languageCode, meanConfidence, preferSecondTry } from '@/lib/language-guard'

const USER = '00000000-0000-4000-8000-0000000000a1'
const TOKENS: Record<string, string> = { 'user-token': USER }

const state = vi.hoisted(() => ({ supabase: null as unknown }))

vi.mock('@/lib/supabase-server', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/supabase-server')>()),
  createAdminClient: () => state.supabase as SupabaseClient,
  validateToken: async (token: string) => TOKENS[token] ?? null,
}))

import { POST as transcribe } from '@/app/api/transcribe/route'

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

// What the owner really got (T-1059): Vietnamese said fast, written as Icelandic.
const SAID = 'bạn kiểm tra cho tôi xem nó đã xong hay chưa'
const ICELANDIC = 'Nú nægði að það sáttíu.'

const verbose = (language: string, text: string, logprob: number, duration = 3) => ({
  task: 'transcribe',
  language,
  duration,
  text,
  segments: [{ id: 0, start: 0, end: duration, text, avg_logprob: logprob, no_speech_prob: 0.01 }],
  x_groq: { id: 'req_1' },
})
const answer = (body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

describe('the language guard, on its own', () => {
  it('reads codes and the names Whisper writes', () => {
    expect(languageCode('Vietnamese')).toBe('vi')
    expect(languageCode(' VI ')).toBe('vi')
    expect(languageCode('english')).toBe('en')
    expect(languageCode('icelandic')).toBe('icelandic')
    expect(languageCode(undefined)).toBe('')
    expect(languageCode(7)).toBe('')
  })

  it('takes the user’s languages from the request, Vietnamese and English otherwise', () => {
    expect(allowedLanguages(null)).toEqual(['vi', 'en'])
    expect(allowedLanguages('')).toEqual(['vi', 'en'])
    expect(allowedLanguages('en,vi')).toEqual(['en', 'vi'])
    expect(allowedLanguages('French, vi,fr')).toEqual(['fr', 'vi'])
    expect(allowedLanguages('<script>,;;,x')).toEqual(['vi', 'en'])
    expect(allowedLanguages('vi,en,fr,de,es,it,ja')).toHaveLength(5)
  })

  it('suspects only a language outside the set', () => {
    expect(guessedOutsideSet('icelandic', ['vi', 'en'])).toBe(true)
    expect(guessedOutsideSet('is', ['vi', 'en'])).toBe(true)
    expect(guessedOutsideSet('vietnamese', ['vi', 'en'])).toBe(false)
    expect(guessedOutsideSet('en', ['vi', 'en'])).toBe(false)
    expect(guessedOutsideSet('french', ['vi', 'en', 'fr'])).toBe(false)
    expect(guessedOutsideSet(undefined, ['vi', 'en'])).toBe(false)
    expect(guessedOutsideSet('', ['vi', 'en'])).toBe(false)
  })

  it('keeps the second answer only when it is at least as sure as the first', () => {
    const first = verbose('icelandic', ICELANDIC, -0.9)
    expect(meanConfidence(first)).toBeCloseTo(-0.9)
    expect(meanConfidence({ text: 'x' })).toBeNull()
    expect(preferSecondTry(first, verbose('vietnamese', SAID, -0.3))).toBe(true)
    // Real French, forced to Vietnamese: the forced answer is less sure, the guess stays.
    expect(preferSecondTry(verbose('french', 'Bonjour, comment allez-vous ?', -0.1), verbose('vietnamese', 'Bon giu, cô man ta lê vu.', -0.8))).toBe(false)
    expect(preferSecondTry(first, verbose('vietnamese', '', -0.1))).toBe(false)
    expect(preferSecondTry(first, { text: SAID })).toBe(true)
  })
})

describe('POST /api/transcribe: the language guard', () => {
  let pg: PGlite
  const fetchMock = vi.fn()

  const secondsUsed = async () => {
    const res = await pg.query<{ seconds_used: number }>('SELECT seconds_used FROM public.usage WHERE user_id = $1', [USER])
    return res.rows[0]?.seconds_used ?? 0
  }
  const sent = (call: number) => fetchMock.mock.calls[call][1].body as FormData

  const request = (fields: Record<string, string> = {}, seconds = 3) => {
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(wav(seconds))], { type: 'audio/wav' }), 'audio.wav')
    for (const [k, v] of Object.entries(fields)) form.append(k, v)
    return transcribe(
      new NextRequest('http://localhost/api/transcribe', {
        method: 'POST',
        headers: { authorization: 'Bearer user-token' },
        body: form,
      })
    )
  }

  beforeAll(async () => {
    pg = await createProductionLikeDb([
      '002_sync.sql',
      '003_mcp_tokens.sql',
      '004_mcp_token_expiry.sql',
      '005_ai_token_usage.sql',
      '006_lock_increment_usage.sql',
      '007_unlimited_accounts.sql',
    ])
    await queryAs(pg, 'supabase_auth_admin', 'INSERT INTO auth.users (id) VALUES ($1)', [USER])
  })
  afterAll(() => pg.close())

  beforeEach(async () => {
    state.supabase = fakeSupabase(pg)
    await pg.exec('DELETE FROM public.usage')
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('sends the audio again with Vietnamese fixed when Whisper guessed Icelandic, and answers with the Vietnamese', async () => {
    fetchMock
      .mockResolvedValueOnce(answer(verbose('icelandic', ICELANDIC, -0.9)))
      .mockResolvedValueOnce(answer(verbose('vietnamese', SAID, -0.3)))

    const res = await request({ response_format: 'verbose_json', prompt: 'Wispra' })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.text).toBe(SAID)
    expect(body.language).toBe('vietnamese')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(sent(0).get('language')).toBeNull()
    expect(sent(1).get('language')).toBe('vi')
    // The same recording, the same model, the app’s own prompt, nothing else added.
    expect(sent(1).get('model')).toBe('whisper-large-v3-turbo')
    expect(sent(1).get('prompt')).toBe('Wispra')
    expect((sent(1).get('file') as Blob).size).toBe(wav(3).length)
    expect(sent(1).getAll('language')).toHaveLength(1)
  })

  it('counts the seconds of the one recording, not of both tries', async () => {
    fetchMock
      .mockResolvedValueOnce(answer(verbose('icelandic', ICELANDIC, -0.9, 3)))
      .mockResolvedValueOnce(answer(verbose('vietnamese', SAID, -0.3, 3)))

    await request()

    expect(await secondsUsed()).toBe(3)
  })

  it('uses the language the app lists first as the one to fix', async () => {
    fetchMock
      .mockResolvedValueOnce(answer(verbose('icelandic', ICELANDIC, -0.9)))
      .mockResolvedValueOnce(answer(verbose('english', 'Please check whether it is done.', -0.2)))

    const res = await request({ languages: 'en,vi' })

    expect((await res.json()).text).toBe('Please check whether it is done.')
    expect(sent(1).get('language')).toBe('en')
  })

  it('does not pass the app’s list of languages on to Groq', async () => {
    fetchMock.mockResolvedValue(answer(verbose('vietnamese', SAID, -0.3)))

    await request({ languages: 'vi,en' })

    expect(sent(0).has('languages')).toBe(false)
  })

  it('makes one call, as before, for a normal answer: Vietnamese, English, or no language named', async () => {
    fetchMock
      .mockResolvedValueOnce(answer(verbose('vietnamese', SAID, -0.3)))
      .mockResolvedValueOnce(answer(verbose('english', 'It is done.', -0.2)))
      .mockResolvedValueOnce(answer({ text: 'A stand-in server names no language.', duration: 2 }))

    for (let i = 0; i < 3; i++) expect((await request()).status).toBe(200)

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(await secondsUsed()).toBe(3 + 3 + 3)
  })

  it('leaves alone a request that names its language, whatever Whisper then says', async () => {
    fetchMock.mockResolvedValueOnce(answer(verbose('icelandic', ICELANDIC, -0.9)))

    const res = await request({ language: 'vi' })

    expect((await res.json()).text).toBe(ICELANDIC)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(sent(0).get('language')).toBe('vi')
  })

  it('keeps the guess of a language the user listed, and a real foreign sentence the second try cannot match', async () => {
    fetchMock.mockResolvedValueOnce(answer(verbose('french', 'Bonjour, comment allez-vous ?', -0.1)))
    const listed = await request({ languages: 'vi,fr' })
    expect((await listed.json()).text).toBe('Bonjour, comment allez-vous ?')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    fetchMock.mockReset()
    fetchMock
      .mockResolvedValueOnce(answer(verbose('french', 'Bonjour, comment allez-vous ?', -0.1)))
      .mockResolvedValueOnce(answer(verbose('vietnamese', 'Bon giu, cô man ta lê vu.', -0.8)))
    const unlisted = await request()
    expect((await unlisted.json()).text).toBe('Bonjour, comment allez-vous ?')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('keeps the first answer when the second try fails, once and without more tries', async () => {
    fetchMock
      .mockResolvedValueOnce(answer(verbose('icelandic', ICELANDIC, -0.9)))
      .mockResolvedValueOnce(new Response('{"error":{"message":"busy"}}', { status: 503 }))
    const failed = await request()
    expect(failed.status).toBe(200)
    expect((await failed.json()).text).toBe(ICELANDIC)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    fetchMock.mockReset()
    fetchMock
      .mockResolvedValueOnce(answer(verbose('icelandic', ICELANDIC, -0.9)))
      .mockRejectedValueOnce(Object.assign(new Error('timed out'), { name: 'TimeoutError' }))
    const timedOut = await request()
    expect((await timedOut.json()).text).toBe(ICELANDIC)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('asks only once even when the second try is again outside the set', async () => {
    fetchMock.mockResolvedValue(answer(verbose('icelandic', ICELANDIC, -0.9)))

    await request()

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('goes to the model that answered when turbo had failed, and logs languages only', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    fetchMock
      .mockResolvedValueOnce(new Response('{"error":{"message":"down"}}', { status: 503 }))
      .mockResolvedValueOnce(answer(verbose('icelandic', ICELANDIC, -0.9)))
      .mockResolvedValueOnce(answer(verbose('vietnamese', SAID, -0.3)))

    await request()
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(sent(2).get('model')).toBe('whisper-large-v3')
    expect(sent(2).get('language')).toBe('vi')
    const line = info.mock.calls.map(c => String(c[0])).find(l => l.startsWith('[transcribe]') && l.includes('"status":200'))!
    expect(JSON.parse(line.slice('[transcribe] '.length)).languageRetry).toEqual({ from: 'icelandic', to: 'vi', used: true })
    expect(line).not.toContain(SAID)
    expect(line).not.toContain(ICELANDIC)
    vi.restoreAllMocks()
  })
})
