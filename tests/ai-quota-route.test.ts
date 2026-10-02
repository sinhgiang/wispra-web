import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { PGlite } from '@electric-sql/pglite'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createTestDb, fakeSupabase, tokensUsed } from './helpers/test-db'

// Bearer token → user id, standing in for Supabase auth.
const FREE_USER = '00000000-0000-4000-8000-0000000000f1'
const PRO_USER = '00000000-0000-4000-8000-0000000000b2'
const TOKENS: Record<string, string> = { 'free-token': FREE_USER, 'pro-token': PRO_USER }

const state = vi.hoisted(() => ({ supabase: null as unknown }))

vi.mock('@/lib/supabase-server', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/supabase-server')>()),
  createAdminClient: () => state.supabase as SupabaseClient,
  validateToken: async (token: string) => TOKENS[token] ?? null,
}))

import { POST } from '@/app/api/chat/completions/route'
import { GET as getUsage } from '@/app/api/usage/route'
import { AI_TOKEN_LIMITS } from '@/lib/ai-quota'

const chatRequest = (token: string) =>
  new NextRequest('http://localhost/api/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'Clean up this text.' }] }),
  })

const groqOk = (totalTokens: number) =>
  new Response(
    JSON.stringify({
      choices: [{ message: { role: 'assistant', content: 'Cleaned text.' } }],
      usage: { prompt_tokens: totalTokens - 10, completion_tokens: 10, total_tokens: totalTokens },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  )

describe('monthly AI token quota on /api/chat/completions', () => {
  let pg: PGlite
  const fetchMock = vi.fn()

  const setUsed = (userId: string, month: string, tokens: number) =>
    pg.query(
      `INSERT INTO public.ai_token_usage (user_id, month, tokens_used) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, month) DO UPDATE SET tokens_used = EXCLUDED.tokens_used`,
      [userId, month, tokens]
    )

  beforeAll(async () => {
    pg = await createTestDb()
    state.supabase = fakeSupabase(pg)
    await pg.query('INSERT INTO auth.users (id) VALUES ($1), ($2)', [FREE_USER, PRO_USER])
    // Free users have no subscriptions row; Pro users have plan = 'pro'.
    await pg.query("INSERT INTO public.subscriptions (user_id, plan) VALUES ($1, 'pro')", [PRO_USER])
  })
  afterAll(() => pg.close())

  beforeEach(async () => {
    await pg.exec('DELETE FROM public.ai_token_usage')
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-15T08:00:00Z'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('has the limits the owner chose', () => {
    expect(AI_TOKEN_LIMITS).toEqual({ free: 300_000, pro: 5_000_000 })
  })

  it('refuses a Free user who has used 300,000 tokens, without calling Groq', async () => {
    await setUsed(FREE_USER, '2026-10', 300_000)

    const res = await POST(chatRequest('free-token'))

    expect(res.status).toBe(402)
    expect(await res.json()).toEqual({
      error: expect.stringContaining('300,000'),
      code: 'ai_quota_exceeded',
      plan: 'free',
      limitTokens: 300_000,
      usedTokens: 300_000,
      resetAt: '2026-11-01T00:00:00.000Z',
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(await tokensUsed(pg, FREE_USER, '2026-10')).toBe(300_000)
  })

  it('lets a Pro user through at the same usage, and counts the tokens Groq reports', async () => {
    await setUsed(PRO_USER, '2026-10', 300_000)
    fetchMock.mockResolvedValueOnce(groqOk(1_234))

    const res = await POST(chatRequest('pro-token'))

    expect(res.status).toBe(200)
    expect((await res.json()).choices[0].message.content).toBe('Cleaned text.')
    expect(await tokensUsed(pg, PRO_USER, '2026-10')).toBe(301_234)
  })

  it('refuses a Pro user at 5,000,000 tokens, with no upgrade wording', async () => {
    await setUsed(PRO_USER, '2026-10', 5_000_000)

    const res = await POST(chatRequest('pro-token'))
    const body = await res.json()

    expect(res.status).toBe(402)
    expect(body).toMatchObject({ code: 'ai_quota_exceeded', plan: 'pro', limitTokens: 5_000_000 })
    expect(body.error).not.toContain('Upgrade')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('resets in a new calendar month', async () => {
    await setUsed(FREE_USER, '2026-10', 300_000)
    expect((await POST(chatRequest('free-token'))).status).toBe(402)

    vi.setSystemTime(new Date('2026-11-01T00:00:01Z'))
    fetchMock.mockResolvedValueOnce(groqOk(500))

    const res = await POST(chatRequest('free-token'))

    expect(res.status).toBe(200)
    expect(await tokensUsed(pg, FREE_USER, '2026-11')).toBe(500)
    expect(await tokensUsed(pg, FREE_USER, '2026-10')).toBe(300_000)
  })

  it('finishes a request that starts under the limit even if it goes over, then refuses the next', async () => {
    await setUsed(FREE_USER, '2026-10', 299_990)
    fetchMock.mockResolvedValueOnce(groqOk(9_000))

    const first = await POST(chatRequest('free-token'))
    expect(first.status).toBe(200)
    expect((await first.json()).choices).toHaveLength(1)
    expect(await tokensUsed(pg, FREE_USER, '2026-10')).toBe(308_990)

    const second = await POST(chatRequest('free-token'))
    expect(second.status).toBe(402)
    expect((await second.json()).usedTokens).toBe(308_990)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('counts both of two simultaneous requests exactly; overshoot is at most the requests in flight', async () => {
    await setUsed(FREE_USER, '2026-10', 299_000)
    // Hold both Groq calls open so both requests pass the check before either is recorded.
    const pending: ((res: Response) => void)[] = []
    fetchMock.mockImplementation(() => new Promise<Response>(resolve => pending.push(resolve)))

    const both = Promise.all([POST(chatRequest('free-token')), POST(chatRequest('free-token'))])
    await vi.waitFor(() => expect(pending).toHaveLength(2))
    pending[0](groqOk(2_000))
    pending[1](groqOk(3_000))
    const [a, b] = await both

    expect([a.status, b.status]).toEqual([200, 200])
    expect(await tokensUsed(pg, FREE_USER, '2026-10')).toBe(304_000)
    expect((await POST(chatRequest('free-token'))).status).toBe(402)
  })

  it('counts tokens when Groq returns an error that still reports usage', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: 'failed' }, usage: { total_tokens: 700 } }), { status: 400 })
    )

    const res = await POST(chatRequest('free-token'))

    expect(res.status).toBe(400)
    expect(await tokensUsed(pg, FREE_USER, '2026-10')).toBe(700)
  })

  it('counts nothing when Groq fails without billing (rate limit, timeout)', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"error":{"message":"rate limited"}}', { status: 429 }))
    expect((await POST(chatRequest('free-token'))).status).toBe(429)

    fetchMock.mockRejectedValueOnce(Object.assign(new Error('timed out'), { name: 'TimeoutError' }))
    const timedOut = await POST(chatRequest('free-token'))
    expect(timedOut.status).toBe(503)
    expect((await timedOut.json()).error).toBe('AI request timed out')

    expect(await tokensUsed(pg, FREE_USER, '2026-10')).toBeNull()
  })

  it('counts an estimate when a successful Groq response has no usage block or is not JSON', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 })
    )
    expect((await POST(chatRequest('free-token'))).status).toBe(200)
    const afterFirst = await tokensUsed(pg, FREE_USER, '2026-10')
    expect(afterFirst).toBeGreaterThan(0)

    fetchMock.mockResolvedValueOnce(new Response('<html>bad gateway</html>', { status: 200 }))
    expect((await POST(chatRequest('free-token'))).status).toBe(502)
    expect(await tokensUsed(pg, FREE_USER, '2026-10')).toBeGreaterThan(afterFirst!)
  })

  it('still returns the AI result when recording the tokens fails', async () => {
    const real = state.supabase as SupabaseClient
    state.supabase = { ...real, rpc: async () => ({ data: null, error: { message: 'db down' } }) }
    fetchMock.mockResolvedValueOnce(groqOk(400))
    try {
      const res = await POST(chatRequest('free-token'))
      expect(res.status).toBe(200)
      expect((await res.json()).choices[0].message.content).toBe('Cleaned text.')
    } finally {
      state.supabase = real
    }
  })

  it('rejects a missing or invalid login before anything else', async () => {
    const noAuth = new NextRequest('http://localhost/api/chat/completions', { method: 'POST', body: '{}' })
    expect((await POST(noAuth)).status).toBe(401)
    expect((await POST(chatRequest('wrong-token'))).status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports AI token usage on /api/usage', async () => {
    await setUsed(FREE_USER, '2026-10', 12_345)
    const res = await getUsage(
      new NextRequest('http://localhost/api/usage', { headers: { authorization: 'Bearer free-token' } })
    )
    expect(await res.json()).toMatchObject({
      plan: 'free',
      usageSeconds: 0,
      limitSeconds: 1800,
      aiTokensUsed: 12_345,
      aiTokensLimit: 300_000,
      aiTokensResetAt: '2026-11-01T00:00:00.000Z',
    })
  })
})

describe('before the migration is applied (no ai_token_usage table)', () => {
  let pg: PGlite
  const fetchMock = vi.fn()

  beforeAll(async () => {
    pg = await createTestDb(['001_initial.sql'])
    await pg.query('INSERT INTO auth.users (id) VALUES ($1)', [FREE_USER])
  })
  afterAll(() => pg.close())

  it('fails open: AI keeps working, nothing is counted', async () => {
    const real = state.supabase
    state.supabase = fakeSupabase(pg)
    vi.stubGlobal('fetch', fetchMock)
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    fetchMock.mockResolvedValueOnce(groqOk(400))
    try {
      const res = await POST(chatRequest('free-token'))
      expect(res.status).toBe(200)
      expect(logged).toHaveBeenCalled()
    } finally {
      state.supabase = real
      vi.unstubAllGlobals()
      vi.restoreAllMocks()
    }
  })
})
