import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { PGlite } from '@electric-sql/pglite'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createTestDb, fakeSupabase } from './helpers/test-db'
import { cappedMaxTokens, DEFAULT_MAX_TOKENS, MAX_TOKENS_CAP } from '@/lib/ai-quota'

// T-0201 (C3): the quota is checked once before a call, so one request with a huge
// max_tokens could run far past it. Groq never gets more than MAX_TOKENS_CAP.

const USER = '00000000-0000-4000-8000-0000000000f1'
const state = vi.hoisted(() => ({ supabase: null as unknown }))

vi.mock('@/lib/supabase-server', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/supabase-server')>()),
  createAdminClient: () => state.supabase as SupabaseClient,
  validateToken: async (token: string) => (token === 'user-token' ? USER : null),
}))

import { POST } from '@/app/api/chat/completions/route'

const chat = (extra: Record<string, unknown>) =>
  POST(
    new NextRequest('http://localhost/api/chat/completions', {
      method: 'POST',
      headers: { authorization: 'Bearer user-token', 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Summarise.' }], ...extra }),
    })
  )

describe('max_tokens cap', () => {
  it('keeps a sensible number, caps a huge one, and defaults anything else', () => {
    expect(MAX_TOKENS_CAP).toBe(16_384)
    expect(cappedMaxTokens(2000)).toBe(2000)
    expect(cappedMaxTokens(16_384)).toBe(16_384)
    expect(cappedMaxTokens(100_000)).toBe(16_384)
    expect(cappedMaxTokens(1500.7)).toBe(1500)
    for (const bad of [undefined, null, 0, -5, Number.NaN, Infinity, '9000', {}]) {
      expect(cappedMaxTokens(bad)).toBe(DEFAULT_MAX_TOKENS)
    }
  })

  describe('POST /api/chat/completions', () => {
    let pg: PGlite
    const fetchMock = vi.fn()
    const sentMaxTokens = () => JSON.parse(fetchMock.mock.calls.at(-1)![1].body as string).max_tokens

    beforeAll(async () => {
      pg = await createTestDb()
      state.supabase = fakeSupabase(pg)
      await pg.query('INSERT INTO auth.users (id) VALUES ($1)', [USER])
    })
    afterAll(() => pg.close())
    beforeEach(() => {
      fetchMock.mockReset()
      fetchMock.mockImplementation(async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }], usage: { total_tokens: 20 } }), { status: 200 })
      )
      vi.stubGlobal('fetch', fetchMock)
      vi.spyOn(console, 'info').mockImplementation(() => {})
    })
    afterEach(() => {
      vi.unstubAllGlobals()
      vi.restoreAllMocks()
    })

    it('sends Groq at most the cap', async () => {
      await chat({ max_tokens: 200_000 })
      expect(sentMaxTokens()).toBe(MAX_TOKENS_CAP)
    })

    it('passes a number under the cap on unchanged', async () => {
      await chat({ max_tokens: 1200 })
      expect(sentMaxTokens()).toBe(1200)
    })

    it('uses the default when the app sends none or nonsense', async () => {
      await chat({})
      expect(sentMaxTokens()).toBe(DEFAULT_MAX_TOKENS)
      await chat({ max_tokens: '50000' })
      expect(sentMaxTokens()).toBe(DEFAULT_MAX_TOKENS)
      await chat({ max_tokens: -1 })
      expect(sentMaxTokens()).toBe(DEFAULT_MAX_TOKENS)
    })
  })
})
