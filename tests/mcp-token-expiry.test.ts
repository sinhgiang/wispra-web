import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { PGlite } from '@electric-sql/pglite'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createProductionLikeDb, fakeSupabase, queryAs } from './helpers/test-db'

// T-0201 (T3): a remote-MCP link is a bearer secret in a URL. Unless the user
// explicitly asks for one that never expires, a new link stops working after 90 days.

const USER = '00000000-0000-4000-8000-0000000000a1'
const state = vi.hoisted(() => ({ supabase: null as unknown }))

vi.mock('@/lib/supabase-server', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/supabase-server')>()),
  createAdminClient: () => state.supabase as SupabaseClient,
  validateToken: async (token: string) => (token === 'user-token' ? USER : null),
}))

import { POST as createLink } from '@/app/api/mcp/token/route'
import { GET as useLink } from '@/app/api/mcp/[token]/route'

const NOW = new Date('2026-10-07T00:00:00Z')
const DAY = 86_400_000

const create = (body?: unknown) =>
  createLink(
    new NextRequest('http://localhost/api/mcp/token', {
      method: 'POST',
      headers: { authorization: 'Bearer user-token', 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  )

const open = (token: string) =>
  useLink(new NextRequest(`http://localhost/api/mcp/${token}`, { headers: { accept: 'application/json, text/event-stream' } }), {
    params: Promise.resolve({ token }),
  })

describe('remote-MCP link expiry', () => {
  let pg: PGlite

  beforeAll(async () => {
    pg = await createProductionLikeDb(['002_sync.sql', '003_mcp_tokens.sql', '004_mcp_token_expiry.sql'])
    await queryAs(pg, 'supabase_auth_admin', 'INSERT INTO auth.users (id) VALUES ($1)', [USER])
  })
  afterAll(() => pg.close())
  beforeEach(async () => {
    state.supabase = fakeSupabase(pg)
    await pg.exec('DELETE FROM public.mcp_tokens')
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
  })
  afterEach(() => vi.useRealTimers())

  it('a link made without an expiry now stops after 90 days', async () => {
    for (const body of [undefined, {}, { expiresInDays: 'soon' }, { expiresInDays: -3 }, { expiresInDays: 0 }]) {
      const res = await create(body)
      expect(res.status).toBe(200)
      expect((await res.json()).expiresAt, JSON.stringify(body)).toBe(new Date(NOW.getTime() + 90 * DAY).toISOString())
    }
  })

  it('keeps a number of days the app chose', async () => {
    expect((await (await create({ expiresInDays: 7 })).json()).expiresAt).toBe(new Date(NOW.getTime() + 7 * DAY).toISOString())
  })

  it('makes a never-expiring link only when the app explicitly sends null', async () => {
    expect((await (await create({ expiresInDays: null })).json()).expiresAt).toBeNull()
  })

  it('the default link works until day 90 and is refused after', async () => {
    const { token } = await (await create()).json()

    vi.setSystemTime(new Date(NOW.getTime() + 89 * DAY))
    expect((await open(token)).status).not.toBe(403)

    vi.setSystemTime(new Date(NOW.getTime() + 91 * DAY))
    const late = await open(token)
    expect(late.status).toBe(403)
    expect((await late.json()).error).toBe('Connection link has expired')
  })

  it('only a hash of the link is stored', async () => {
    const { token } = await (await create()).json()
    const rows = (await pg.query<{ token_hash: string }>('SELECT token_hash FROM public.mcp_tokens')).rows
    expect(rows).toHaveLength(1)
    expect(rows[0].token_hash).not.toContain(token)
    expect(rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/)
  })
})
