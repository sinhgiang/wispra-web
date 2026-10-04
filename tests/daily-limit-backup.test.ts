import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { PGlite } from '@electric-sql/pglite'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createProductionLikeDb, fakeSupabase, queryAs, tokensUsed } from './helpers/test-db'

const USER = '00000000-0000-4000-8000-0000000000d1'

const state = vi.hoisted(() => ({ supabase: null as unknown }))

vi.mock('@/lib/supabase-server', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/supabase-server')>()),
  createAdminClient: () => state.supabase as SupabaseClient,
  validateToken: async (token: string) => (token === 'user-token' ? USER : null),
}))

import { POST } from '@/app/api/chat/completions/route'

const MAIN = 'openai/gpt-oss-120b'
const BACKUP = 'openai/gpt-oss-20b'

const chat = (extra: Record<string, unknown> = {}) =>
  POST(
    new NextRequest('http://localhost/api/chat/completions', {
      method: 'POST',
      headers: { authorization: 'Bearer user-token', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MAIN,
        messages: [{ role: 'user', content: 'Find the topics.' }],
        max_tokens: 2500,
        response_format: { type: 'json_object' },
        ...extra,
      }),
    })
  )

// The daily-limit answer Groq gave the server on 2026-10-04 (from the [ai-call] log).
const dailyLimit = (model: string) =>
  new Response(
    JSON.stringify({
      error: {
        message: `Rate limit reached for model \`${model}\` in organization \`org_test\` service tier \`on_demand\` on tokens per day (TPD): Limit 200000, Used 199503, Requested 4514. Please try again in 28m55.34s. Need more tokens? Upgrade to Dev Tier today at https://console.groq.com/settings/billing`,
        type: 'tokens',
        code: 'rate_limit_exceeded',
      },
    }),
    { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '1736' } }
  )

const perMinuteLimit = () =>
  new Response(
    JSON.stringify({
      error: {
        message: 'Rate limit reached for model `openai/gpt-oss-120b` on tokens per minute (TPM): Limit 8000, Used 7900, Requested 4200. Please try again in 30.5s.',
        type: 'tokens',
        code: 'rate_limit_exceeded',
      },
    }),
    { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '31' } }
  )

const ok = (model: string, tokens: number) =>
  new Response(
    JSON.stringify({
      model,
      choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '{"topics":[]}' } }],
      usage: { prompt_tokens: tokens - 100, completion_tokens: 100, total_tokens: tokens },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  )

const modelSent = (fetchMock: ReturnType<typeof vi.fn>, n: number) =>
  (JSON.parse(fetchMock.mock.calls[n][1].body as string) as { model: string }).model

describe('backup model when gpt-oss-120b reaches its daily limit', () => {
  let pg: PGlite
  const fetchMock = vi.fn()
  let logged: string[]
  const month = new Date().toISOString().slice(0, 7)

  beforeAll(async () => {
    pg = await createProductionLikeDb()
    await queryAs(pg, 'supabase_auth_admin', 'INSERT INTO auth.users (id) VALUES ($1)', [USER])
    state.supabase = fakeSupabase(pg)
  })
  afterAll(() => pg.close())

  beforeEach(async () => {
    await pg.exec('DELETE FROM public.ai_token_usage')
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

  const aiCallLines = () => logged.filter(l => l.startsWith('[ai-call]')).map(l => JSON.parse(l.slice('[ai-call] '.length)))

  it('answers from gpt-oss-20b and says so, with the same request', async () => {
    fetchMock.mockResolvedValueOnce(dailyLimit(MAIN)).mockResolvedValueOnce(ok(BACKUP, 1200))

    const res = await chat()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.backup_model).toBe(BACKUP)
    expect(body.choices[0].message.content).toBe('{"topics":[]}')
    expect(res.headers.get('x-wispra-backup-model')).toBe(BACKUP)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(modelSent(fetchMock, 0)).toBe(MAIN)
    expect(modelSent(fetchMock, 1)).toBe(BACKUP)
    const [first, second] = fetchMock.mock.calls.map(c => JSON.parse(c[1].body as string))
    expect({ ...second, model: MAIN }).toEqual(first)

    // The backup's tokens count toward the account like any other call.
    expect(await tokensUsed(pg, USER, month)).toBe(1200)
  })

  it('logs both calls, the second one marked as the backup', async () => {
    fetchMock.mockResolvedValueOnce(dailyLimit(MAIN)).mockResolvedValueOnce(ok(BACKUP, 1200))

    await chat()

    const lines = aiCallLines()
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({ status: 429, model: MAIN })
    expect(lines[0].groqError).toContain('tokens per day (TPD)')
    expect(lines[0]).not.toHaveProperty('backupFor')
    expect(lines[1]).toMatchObject({ status: 200, model: BACKUP, backupFor: MAIN, completionTokens: 100 })
  })

  it('when both models are at their daily limit, returns the original daily-limit error as before', async () => {
    fetchMock.mockResolvedValueOnce(dailyLimit(MAIN)).mockResolvedValueOnce(dailyLimit(BACKUP))

    const res = await chat()

    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toBe('1736')
    expect(res.headers.get('x-wispra-backup-model')).toBeNull()
    const body = await res.json()
    expect(body).not.toHaveProperty('backup_model')
    const groq = JSON.parse(body.error)
    expect(groq.error.message).toContain(`model \`${MAIN}\``)
    expect(groq.error.message).toContain('tokens per day (TPD)')

    const lines = aiCallLines()
    expect(lines.map(l => [l.status, l.model, l.backupFor ?? null])).toEqual([
      [429, MAIN, null],
      [429, BACKUP, MAIN],
    ])
  })

  it('returns the original daily-limit error when the backup fails in another way', async () => {
    fetchMock.mockResolvedValueOnce(dailyLimit(MAIN)).mockRejectedValueOnce(Object.assign(new Error('t'), { name: 'TimeoutError' }))

    const res = await chat()

    expect(res.status).toBe(429)
    expect(JSON.parse((await res.json()).error).error.message).toContain(MAIN)
  })

  it('does not use the backup for a per-minute limit (the app waits that out)', async () => {
    fetchMock.mockResolvedValueOnce(perMinuteLimit())

    const res = await chat()

    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toBe('31')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not use the backup when another model was asked for, or for other errors', async () => {
    fetchMock.mockResolvedValueOnce(dailyLimit('llama-3.1-8b-instant'))
    expect((await chat({ model: 'llama-3.1-8b-instant' })).status).toBe(429)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    fetchMock.mockResolvedValueOnce(new Response('{"error":{"message":"Request too large"}}', { status: 413 }))
    expect((await chat()).status).toBe(413)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("logs the server key's limits from Groq's headers", async () => {
    const res = ok(MAIN, 900)
    const headers = new Headers(res.headers)
    headers.set('x-ratelimit-limit-requests', '1000')
    headers.set('x-ratelimit-remaining-requests', '987')
    headers.set('x-ratelimit-limit-tokens', '8000')
    headers.set('x-ratelimit-remaining-tokens', '7100')
    fetchMock.mockResolvedValueOnce(new Response(await res.text(), { status: 200, headers }))

    await chat()

    expect(aiCallLines()[0].limits).toEqual({
      requestsPerDay: 1000,
      requestsLeftToday: 987,
      tokensPerMinute: 8000,
      tokensLeftThisMinute: 7100,
    })
  })

  it('a normal answer from gpt-oss-120b is unchanged and not marked', async () => {
    fetchMock.mockResolvedValueOnce(ok(MAIN, 900))

    const res = await chat()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).not.toHaveProperty('backup_model')
    expect(body.model).toBe(MAIN)
    expect(res.headers.get('x-wispra-backup-model')).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
