import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { PGlite } from '@electric-sql/pglite'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createProductionLikeDb, fakeSupabase, queryAs, readMigration } from './helpers/test-db'

const ALICE = '00000000-0000-4000-8000-0000000000a1'
const BOB = '00000000-0000-4000-8000-0000000000b2'
const TOKENS: Record<string, string> = { 'alice-token': ALICE, 'bob-token': BOB }

const state = vi.hoisted(() => ({ supabase: null as unknown }))

vi.mock('@/lib/supabase-server', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/supabase-server')>()),
  createAdminClient: () => state.supabase as SupabaseClient,
  validateToken: async (token: string) => TOKENS[token] ?? null,
}))

import { GET as readLexicon, PUT as writeLexicon } from '@/app/api/lexicon/route'

const MIGRATIONS = [
  '002_sync.sql',
  '003_mcp_tokens.sql',
  '004_mcp_token_expiry.sql',
  '005_ai_token_usage.sql',
  '006_lock_increment_usage.sql',
  '007_unlimited_accounts.sql',
  '008_history_deletions.sql',
  '009_synced_vocabulary.sql',
]

const auth = (token?: string): Record<string, string> => (token ? { authorization: `Bearer ${token}` } : {})

const get = (token?: string) => readLexicon(new NextRequest('http://localhost/api/lexicon', { headers: auth(token) }))
const put = (token: string | undefined, body: unknown) =>
  writeLexicon(
    new NextRequest('http://localhost/api/lexicon', {
      method: 'PUT',
      headers: { ...auth(token), 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  )
const read = async (token: string) => (await get(token)).json()

const word = (id: string, term: string, extra: Record<string, unknown> = {}) => ({
  id,
  term,
  heardAs: [term.toLowerCase()],
  count: 2,
  enabled: true,
  pinned: false,
  source: 'fix',
  createdAt: '2026-10-06T08:00:00.000Z',
  lastSeen: '2026-10-06T09:00:00.000Z',
  ...extra,
})

describe('GET / PUT /api/lexicon', () => {
  let pg: PGlite

  beforeAll(async () => {
    pg = await createProductionLikeDb(MIGRATIONS)
    await queryAs(pg, 'supabase_auth_admin', 'INSERT INTO auth.users (id) VALUES ($1), ($2)', [ALICE, BOB])
  })
  afterAll(() => pg.close())

  beforeEach(async () => {
    state.supabase = fakeSupabase(pg)
    await pg.exec('DELETE FROM public.synced_vocabulary; DELETE FROM public.synced_lexicon;')
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-07T01:00:00Z'))
  })

  it('a new account reads empty lists', async () => {
    const res = await get('alice-token')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ vocabulary: { terms: [], updatedAt: null }, lexicon: [] })
  })

  it('stores and reads back the signed-in user’s vocabulary and learned words', async () => {
    const res = await put('alice-token', {
      vocabulary: ['Github', 'Capcut', 'TikTok'],
      lexicon: [word('w1', 'Wispra'), word('w2', 'Lenvid', { heardAs: ['lenvit', 'len vid'], pinned: true })],
    })
    expect(await res.json()).toEqual({ ok: true, vocabulary: 3, lexicon: 2 })

    const back = await read('alice-token')
    expect(back.vocabulary).toEqual({ terms: ['Github', 'Capcut', 'TikTok'], updatedAt: '2026-10-07T01:00:00.000Z' })
    expect(back.lexicon).toEqual([
      { ...word('w1', 'Wispra'), syncedAt: '2026-10-07T01:00:00.000Z' },
      { ...word('w2', 'Lenvid', { heardAs: ['lenvit', 'len vid'], pinned: true }), syncedAt: '2026-10-07T01:00:00.000Z' },
    ])
  })

  it('two accounts never see or change each other’s lists', async () => {
    await put('alice-token', { vocabulary: ['Alice Term'], lexicon: [word('shared-id', 'AliceWord')] })

    // Bob starts empty, even though Alice has data.
    expect(await read('bob-token')).toEqual({ vocabulary: { terms: [], updatedAt: null }, lexicon: [] })

    // Bob writes with the same lexicon id and tries to name Alice in the body.
    await put('bob-token', {
      vocabulary: ['Bob Term'],
      lexicon: [{ ...word('shared-id', 'BobWord'), userId: ALICE, user_id: ALICE }],
      userId: ALICE,
    })
    // Bob replacing his list with nothing removes only his own words.
    await put('bob-token', { lexicon: [] })

    const alice = await read('alice-token')
    expect(alice.vocabulary.terms).toEqual(['Alice Term'])
    expect(alice.lexicon.map((w: { id: string; term: string }) => [w.id, w.term])).toEqual([['shared-id', 'AliceWord']])

    const bob = await read('bob-token')
    expect(bob.vocabulary.terms).toEqual(['Bob Term'])
    expect(bob.lexicon).toEqual([])
  })

  it('a list that is present replaces the stored one; a list left out is untouched', async () => {
    await put('alice-token', { vocabulary: ['A', 'B'], lexicon: [word('w1', 'One'), word('w2', 'Two'), word('w3', 'Three')] })

    // Only the lexicon: w2 removed, w1 changed, w4 added. Vocabulary untouched.
    await put('alice-token', { lexicon: [word('w1', 'One again'), word('w3', 'Three'), word('w4', 'Four')] })
    let back = await read('alice-token')
    expect(back.vocabulary.terms).toEqual(['A', 'B'])
    expect(back.lexicon.map((w: { id: string; term: string }) => `${w.id}:${w.term}`)).toEqual(['w1:One again', 'w3:Three', 'w4:Four'])

    // Only the vocabulary.
    await put('alice-token', { vocabulary: ['C'] })
    back = await read('alice-token')
    expect(back.vocabulary.terms).toEqual(['C'])
    expect(back.lexicon).toHaveLength(3)
  })

  it('cleans the vocabulary: trims, drops empty terms and exact duplicates, keeps the order', async () => {
    const res = await put('alice-token', { vocabulary: ['  Github ', '', 'TikTok', 'Github', 'tiktok', '   '] })
    expect(await res.json()).toEqual({ ok: true, vocabulary: 3 })
    expect((await read('alice-token')).vocabulary.terms).toEqual(['Github', 'TikTok', 'tiktok'])
  })

  it('refuses a missing or invalid sign-in on both routes, and changes nothing', async () => {
    await put('alice-token', { vocabulary: ['Keep'] })
    expect((await get()).status).toBe(401)
    expect((await get('stolen-token')).status).toBe(401)
    expect((await put(undefined, { vocabulary: [] })).status).toBe(401)
    expect((await put('stolen-token', { vocabulary: [] })).status).toBe(401)
    expect((await read('alice-token')).vocabulary.terms).toEqual(['Keep'])
  })

  it('rejects bad input without writing anything', async () => {
    await put('alice-token', { vocabulary: ['Keep'], lexicon: [word('w1', 'Keep')] })

    const bad = [
      'not json',
      {},
      { vocabulary: 'Github' },
      { vocabulary: ['ok', 42] },
      { vocabulary: ['x'.repeat(201)] },
      { vocabulary: Array.from({ length: 2001 }, (_, i) => `t${i}`) },
      { lexicon: {} },
      { lexicon: [word('', 'x')] },
      { lexicon: [word('w2', '')] },
      { lexicon: [word('w2', 'x', { count: 'many' })] },
      { lexicon: [word('w2', 'x', { createdAt: 'yesterday' })] },
      // A valid vocabulary with an invalid lexicon: nothing is written, not even the vocabulary.
      { vocabulary: ['Changed'], lexicon: [word('w2', 'x', { enabled: 'yes' })] },
    ]
    for (const body of bad) expect((await put('alice-token', body)).status, JSON.stringify(body).slice(0, 60)).toBe(400)

    const back = await read('alice-token')
    expect(back.vocabulary.terms).toEqual(['Keep'])
    expect(back.lexicon.map((w: { id: string }) => w.id)).toEqual(['w1'])
  })

  it('if writing the learned words fails, the old ones are kept', async () => {
    await put('alice-token', { lexicon: [word('w1', 'One'), word('w2', 'Two')] })
    const real = fakeSupabase(pg)
    const failingUpsert = {
      upsert: () => ({ then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { message: 'connection reset' } }).then(resolve) }),
    }
    state.supabase = { ...real, from: (t: string) => (t === 'synced_lexicon' ? { ...real.from(t), ...failingUpsert } : real.from(t)) }

    const res = await put('alice-token', { lexicon: [word('w3', 'Three')] })

    expect(res.status).toBe(500)
    state.supabase = real
    expect((await read('alice-token')).lexicon.map((w: { id: string }) => w.id)).toEqual(['w1', 'w2'])
  })

  it('handles more than 1,000 learned words (Supabase pages at 1,000 rows)', async () => {
    const many = Array.from({ length: 1500 }, (_, i) => word(`w${String(i).padStart(4, '0')}`, `Term ${i}`))
    expect(await (await put('alice-token', { lexicon: many })).json()).toEqual({ ok: true, lexicon: 1500 })
    expect((await read('alice-token')).lexicon).toHaveLength(1500)

    // Keep only the last 200: the 1,300 others go, including those past row 1,000.
    expect(await (await put('alice-token', { lexicon: many.slice(1300) })).json()).toEqual({ ok: true, lexicon: 200 })
    const back = await read('alice-token')
    expect(back.lexicon).toHaveLength(200)
    expect(back.lexicon[0].id).toBe('w1300')
  })
})

describe('before migration 009 is applied', () => {
  let pg: PGlite

  beforeAll(async () => {
    pg = await createProductionLikeDb(MIGRATIONS.slice(0, -1))
    await queryAs(pg, 'supabase_auth_admin', 'INSERT INTO auth.users (id) VALUES ($1)', [ALICE])
    state.supabase = fakeSupabase(pg)
  })
  afterAll(() => pg.close())

  it('reading works with an empty vocabulary; saving the vocabulary says the server is not ready', async () => {
    state.supabase = fakeSupabase(pg)
    await pg.query("INSERT INTO public.synced_lexicon (user_id, id, term) VALUES ($1, 'w1', 'Wispra')", [ALICE])

    const back = await read('alice-token')
    expect(back.vocabulary).toEqual({ terms: [], updatedAt: null })
    expect(back.lexicon.map((w: { term: string }) => w.term)).toEqual(['Wispra'])

    expect((await put('alice-token', { vocabulary: ['Github'] })).status).toBe(503)
    expect((await put('alice-token', { lexicon: [word('w2', 'Two')] })).status).toBe(200)
  })
})

describe('migration 009_synced_vocabulary', () => {
  let pg: PGlite

  beforeAll(async () => {
    pg = await createProductionLikeDb(MIGRATIONS)
    await queryAs(pg, 'supabase_auth_admin', 'INSERT INTO auth.users (id) VALUES ($1)', [ALICE])
  })
  afterAll(() => pg.close())

  it('only adds one table: key on user_id, RLS on, no policies, invisible to anon and signed-in users', async () => {
    await pg.query("INSERT INTO public.synced_vocabulary (user_id, terms) VALUES ($1, ARRAY['Github'])", [ALICE])

    const cols = await pg.query<{ name: string; type: string }>(
      "SELECT attname AS name, format_type(atttypid, atttypmod) AS type FROM pg_attribute WHERE attrelid = 'public.synced_vocabulary'::regclass AND attnum > 0 AND NOT attisdropped ORDER BY attnum"
    )
    expect(cols.rows).toEqual([
      { name: 'user_id', type: 'uuid' },
      { name: 'terms', type: 'text[]' },
      { name: 'updated_at', type: 'timestamp with time zone' },
    ])
    const rls = await pg.query<{ on: boolean }>("SELECT relrowsecurity AS on FROM pg_class WHERE oid = 'public.synced_vocabulary'::regclass")
    expect(rls.rows[0].on).toBe(true)
    expect((await pg.query("SELECT 1 FROM pg_policies WHERE tablename = 'synced_vocabulary'")).rows).toHaveLength(0)
    for (const role of ['anon', 'authenticated']) {
      const seen = await queryAs<{ n: number }>(pg, role, 'SELECT count(*)::int AS n FROM public.synced_vocabulary')
      expect(seen.rows[0].n).toBe(0)
    }
  })

  it('removes a user’s row with the user, and can be applied twice without losing data', async () => {
    await pg.exec(readMigration('009_synced_vocabulary.sql'))
    expect((await pg.query('SELECT 1 FROM public.synced_vocabulary WHERE user_id = $1', [ALICE])).rows).toHaveLength(1)
    await pg.query('DELETE FROM auth.users WHERE id = $1', [ALICE])
    expect((await pg.query('SELECT 1 FROM public.synced_vocabulary WHERE user_id = $1', [ALICE])).rows).toHaveLength(0)
  })
})
