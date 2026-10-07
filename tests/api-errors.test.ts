import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { PGlite } from '@electric-sql/pglite'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createTestDb, fakeSupabase } from './helpers/test-db'
import { cleanGroqError } from '@/lib/groq-errors'

// T-0201 (L4): error answers say what failed; the database's own message goes to
// the server log only. Groq's answers still reach the apps (they read them), minus
// the server account's organization id.

const USER = '00000000-0000-4000-8000-0000000000a1'
const DB_DETAIL = 'relation "public.synced_lexicon" violates constraint synced_lexicon_pkey'
const state = vi.hoisted(() => ({ supabase: null as unknown }))

vi.mock('@/lib/supabase-server', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/supabase-server')>()),
  createAdminClient: () => state.supabase as SupabaseClient,
  validateToken: async (token: string) => (token === 'user-token' ? USER : null),
}))

import { GET as readLexicon } from '@/app/api/lexicon/route'
import { GET as readHistory } from '@/app/api/history/route'
import { POST as chat } from '@/app/api/chat/completions/route'
import { registerTools } from '@/lib/mcp/tools'

const TPD_429 = JSON.stringify({
  error: {
    message:
      'Rate limit reached for model `openai/gpt-oss-120b` in organization `org_01jx9abcdEFG` service tier `on_demand` on tokens per day (TPD): Limit 200000, Used 199503, Requested 4514.',
    type: 'tokens',
    code: 'rate_limit_exceeded',
  },
})

describe('cleanGroqError', () => {
  it('takes out the organization id and keeps everything the apps read', () => {
    const cleaned = cleanGroqError(TPD_429)
    expect(cleaned).not.toContain('org_01jx9abcdEFG')
    expect(cleaned).toContain('organization `org_…`')
    expect(cleaned).toContain('tokens per day (TPD)')
    expect(cleaned).toContain('openai/gpt-oss-120b')
    expect(JSON.parse(cleaned).error.code).toBe('rate_limit_exceeded')
  })

  it('leaves ordinary text alone, including words that merely contain "org"', () => {
    for (const text of [
      '{"error":{"message":"Request too large for model on tokens per minute (TPM)"}}',
      'The organization of this text is fine.',
      'my_org_settings and storg_x stay as they are',
      '',
    ]) {
      expect(cleanGroqError(text)).toBe(text)
    }
  })
})

describe('database errors are not shown to callers', () => {
  let pg: PGlite
  const brokenDb = () => {
    const real = fakeSupabase(pg)
    const broken = () => {
      const fail = Promise.resolve({ data: null, error: { message: DB_DETAIL, code: '23505' } })
      const q: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'lt', 'not', 'in', 'order', 'limit', 'range', 'upsert', 'insert', 'delete', 'update']) q[m] = () => q
      q.maybeSingle = () => fail
      q.single = () => fail
      q.then = (resolve: (v: unknown) => unknown, reject?: (r: unknown) => unknown) => fail.then(resolve, reject)
      return q
    }
    return { ...real, from: () => broken() }
  }

  beforeAll(async () => {
    pg = await createTestDb(['001_initial.sql', '002_sync.sql', '005_ai_token_usage.sql'])
    await pg.query('INSERT INTO auth.users (id) VALUES ($1)', [USER])
  })
  afterAll(() => pg.close())
  let log: { mock: { calls: unknown[][] } }
  beforeEach(() => {
    state.supabase = brokenDb()
    log = vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  const get = (handler: (req: NextRequest) => Promise<Response>, url: string) =>
    handler(new NextRequest(url, { headers: { authorization: 'Bearer user-token' } }))

  it('a route answers what failed, and logs the database message', async () => {
    for (const [handler, url] of [
      [readLexicon, 'http://localhost/api/lexicon'],
      [readHistory, 'http://localhost/api/history'],
    ] as const) {
      const res = await get(handler, url)
      expect(res.status).toBe(500)
      const body = JSON.stringify(await res.json())
      expect(body).not.toContain('synced_lexicon')
      expect(body).not.toContain('constraint')
      expect(body).toMatch(/Could not read/)
    }
    expect(log.mock.calls.some(call => String(call[1]).includes(DB_DETAIL))).toBe(true)
  })

  it('an MCP tool answers what failed, and logs the database message', async () => {
    const handlers: Record<string, (args: Record<string, unknown>) => Promise<{ content: { text: string }[] }>> = {}
    const server = { registerTool: (name: string, _def: unknown, handler: (typeof handlers)[string]) => (handlers[name] = handler) }
    registerTools(server as never, USER)

    expect(Object.keys(handlers)).toHaveLength(7)
    for (const [name, handler] of Object.entries(handlers)) {
      const text = (await handler({ id: 'x', query: 'x' })).content[0].text
      expect(text, name).not.toContain('synced_')
      expect(JSON.parse(text).error, name).toMatch(/^Could not /)
    }
    expect(log.mock.calls.every(call => String(call[0]).startsWith('[mcp]'))).toBe(true)
  })

  it('a Groq daily-limit 429 still reaches the app, without the organization id', async () => {
    state.supabase = fakeSupabase(pg)
    vi.spyOn(console, 'info').mockImplementation(() => {})
    // Main model and backup both at their daily limit.
    vi.stubGlobal('fetch', vi.fn(async () => new Response(TPD_429, { status: 429 })))

    const res = await chat(
      new NextRequest('http://localhost/api/chat/completions', {
        method: 'POST',
        headers: { authorization: 'Bearer user-token', 'content-type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'Hi' }] }),
      })
    )

    expect(res.status).toBe(429)
    const error = (await res.json()).error as string
    expect(error).toContain('tokens per day (TPD)')
    expect(error).not.toContain('org_01jx9abcdEFG')
  })
})
