import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { PGlite } from '@electric-sql/pglite'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createProductionLikeDb, fakeSupabase, queryAs } from './helpers/test-db'

const USER = '00000000-0000-4000-8000-0000000000c1'

const state = vi.hoisted(() => ({ supabase: null as unknown }))

vi.mock('@/lib/supabase-server', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/supabase-server')>()),
  createAdminClient: () => state.supabase as SupabaseClient,
  validateToken: async (token: string) => (token === 'user-token' ? USER : null),
}))

import { POST } from '@/app/api/chat/completions/route'

const SECRET_PROMPT = 'Private meeting about the Q4 budget'

const chat = (extra: Record<string, unknown> = {}) =>
  POST(
    new NextRequest('http://localhost/api/chat/completions', {
      method: 'POST',
      headers: { authorization: 'Bearer user-token', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'openai/gpt-oss-120b',
        messages: [
          { role: 'system', content: 'Return JSON only.' },
          { role: 'user', content: SECRET_PROMPT },
        ],
        max_tokens: 4000,
        temperature: 0.3,
        ...extra,
      }),
    })
  )

const groqJson = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

/** What the route sent to Groq on the n-th call. */
const sentToGroq = (fetchMock: ReturnType<typeof vi.fn>, n = 0) =>
  JSON.parse(fetchMock.mock.calls[n][1].body as string) as Record<string, unknown>

describe('Wispra Cloud chat behaves like a direct Groq call', () => {
  let pg: PGlite
  const fetchMock = vi.fn()
  let logged: string[]

  beforeAll(async () => {
    pg = await createProductionLikeDb()
    await queryAs(pg, 'supabase_auth_admin', 'INSERT INTO auth.users (id) VALUES ($1)', [USER])
    state.supabase = fakeSupabase(pg)
  })
  afterAll(() => pg.close())

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    logged = []
    const capture = (...args: unknown[]) => void logged.push(args.map(String).join(' '))
    vi.spyOn(console, 'info').mockImplementation(capture)
    vi.spyOn(console, 'error').mockImplementation(capture)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('passes JSON mode on to Groq (it used to be dropped)', async () => {
    fetchMock.mockResolvedValueOnce(groqJson(200, { choices: [{ message: { content: '{"topics":[]}' } }], usage: { total_tokens: 900 } }))

    const res = await chat({ response_format: { type: 'json_object' } })

    expect(res.status).toBe(200)
    expect(sentToGroq(fetchMock)).toMatchObject({
      model: 'openai/gpt-oss-120b',
      max_tokens: 4000,
      temperature: 0.3,
      response_format: { type: 'json_object' },
    })
  })

  it('sends no response_format when the app asks for none, and drops unknown ones', async () => {
    fetchMock.mockResolvedValue(groqJson(200, { choices: [{ message: { content: 'ok' } }], usage: { total_tokens: 10 } }))

    await chat()
    await chat({ response_format: { type: 'json_schema', json_schema: {} } })

    expect(sentToGroq(fetchMock, 0)).not.toHaveProperty('response_format')
    expect(sentToGroq(fetchMock, 1)).not.toHaveProperty('response_format')
  })

  it("passes Groq's retry-after and rate-limit headers back with a 429", async () => {
    fetchMock.mockResolvedValueOnce(
      groqJson(
        429,
        { error: { message: 'Rate limit reached for model `openai/gpt-oss-120b` on tokens per minute (TPM): Limit 8000, Used 7900, Requested 4200. Please try again in 30.5s.', type: 'tokens', code: 'rate_limit_exceeded' } },
        { 'retry-after': '31', 'x-ratelimit-limit-tokens': '8000', 'x-ratelimit-remaining-tokens': '100', 'x-request-id': 'req_1' }
      )
    )

    const res = await chat({ response_format: { type: 'json_object' } })

    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toBe('31')
    expect(res.headers.get('x-ratelimit-limit-tokens')).toBe('8000')
    expect(res.headers.get('x-ratelimit-remaining-tokens')).toBe('100')
    expect(res.headers.get('x-request-id')).toBeNull()
    // The body keeps its old shape, which the app already reads.
    expect(JSON.parse((await res.json()).error).error.code).toBe('rate_limit_exceeded')
  })

  it('logs one line per call with status, sizes and Groq’s error, never the prompt or answer', async () => {
    fetchMock.mockResolvedValueOnce(
      groqJson(413, { error: { message: 'Request too large for model `openai/gpt-oss-120b` on tokens per minute (TPM): Limit 8000, Requested 9100', type: 'tokens', code: 'rate_limit_exceeded' } })
    )
    fetchMock.mockResolvedValueOnce(
      groqJson(200, { choices: [{ finish_reason: 'stop', message: { content: '{"topics":["Budget"]}' } }], usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 } })
    )

    expect((await chat({ response_format: { type: 'json_object' } })).status).toBe(413)
    expect((await chat({ response_format: { type: 'json_object' } })).status).toBe(200)

    const lines = logged.filter(l => l.startsWith('[ai-call]'))
    expect(lines).toHaveLength(2)
    const failed = JSON.parse(lines[0].slice('[ai-call] '.length))
    expect(failed).toMatchObject({ status: 413, model: 'openai/gpt-oss-120b', jsonMode: true, maxTokens: 4000 })
    expect(failed.groqError).toContain('Request too large')
    const ok = JSON.parse(lines[1].slice('[ai-call] '.length))
    expect(ok).toMatchObject({ status: 200, promptTokens: 50, completionTokens: 20, finishReason: 'stop', answerChars: 21 })
    for (const line of lines) {
      expect(line).not.toContain(SECRET_PROMPT)
      expect(line).not.toContain('Budget')
      expect(line).not.toContain(USER)
    }
  })

  it('a timeout is logged and answered with 503, as before', async () => {
    fetchMock.mockRejectedValueOnce(Object.assign(new Error('timed out'), { name: 'TimeoutError' }))

    const res = await chat()

    expect(res.status).toBe(503)
    expect((await res.json()).error).toBe('AI request timed out')
    expect(logged.some(l => l.startsWith('[ai-call]') && l.includes('"status":"timeout"'))).toBe(true)
  })

  it('waits up to 55 seconds for Groq (the app waits 60)', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    fetchMock.mockResolvedValueOnce(groqJson(200, { choices: [{ message: { content: 'ok' } }], usage: { total_tokens: 5 } }))

    await chat()

    expect(timeout).toHaveBeenCalledWith(55_000)
  })
})
