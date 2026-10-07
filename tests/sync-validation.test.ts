import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { PGlite } from '@electric-sql/pglite'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createProductionLikeDb, fakeSupabase, queryAs } from './helpers/test-db'
import { HISTORY_SYNC_MAX } from '@/lib/history'
import { LEXICON_MAX } from '@/lib/lexicon'
import { invalidMeeting, MEETINGS_SYNC_MAX } from '@/lib/meetings'

// T-0201 (T4): /api/sync checks the whole request before it deletes or writes
// anything, has caps, and writes before it removes.

const ALICE = '00000000-0000-4000-8000-0000000000a1'
const BOB = '00000000-0000-4000-8000-0000000000b2'
const TOKENS: Record<string, string> = { 'alice-token': ALICE, 'bob-token': BOB }

const state = vi.hoisted(() => ({ supabase: null as unknown }))

vi.mock('@/lib/supabase-server', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/supabase-server')>()),
  createAdminClient: () => state.supabase as SupabaseClient,
  validateToken: async (token: string) => TOKENS[token] ?? null,
}))

import { POST as syncRoute } from '@/app/api/sync/route'

const sync = (token: string, body: unknown) =>
  syncRoute(
    new NextRequest('http://localhost/api/sync', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  )

const entry = (id: string, minute: number, text = `Entry ${id}`) => ({
  id,
  text,
  createdAt: new Date(Date.UTC(2026, 9, 6, 8, minute)).toISOString(),
  app: 'Notes',
  durationSeconds: 3,
})
const word = (id: string, term: string) => ({ id, term, count: 1, enabled: true })
const meeting = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: `Meeting ${id}`,
  createdAt: '2026-10-06T08:00:00.000Z',
  durationMs: 60_000,
  status: 'done',
  segments: [{ text: 'Hello' }],
  ...extra,
})

describe('/api/sync input checks', () => {
  let pg: PGlite

  const historyOf = async (userId: string) =>
    (await pg.query<{ id: string; text: string }>('SELECT id, text FROM public.synced_history WHERE user_id = $1 ORDER BY id', [userId])).rows
  const lexiconOf = async (userId: string) =>
    (await pg.query<{ id: string; term: string }>('SELECT id, term FROM public.synced_lexicon WHERE user_id = $1 ORDER BY id', [userId])).rows
  const meetingIdsOf = async (userId: string) =>
    (await pg.query<{ id: string }>('SELECT id FROM public.synced_meetings WHERE user_id = $1 ORDER BY id', [userId])).rows.map(r => r.id)

  beforeAll(async () => {
    pg = await createProductionLikeDb([
      '002_sync.sql',
      '003_mcp_tokens.sql',
      '004_mcp_token_expiry.sql',
      '005_ai_token_usage.sql',
      '006_lock_increment_usage.sql',
      '007_unlimited_accounts.sql',
      '008_history_deletions.sql',
      '009_synced_vocabulary.sql',
    ])
    await queryAs(pg, 'supabase_auth_admin', 'INSERT INTO auth.users (id) VALUES ($1), ($2)', [ALICE, BOB])
  })
  afterAll(() => pg.close())

  beforeEach(async () => {
    state.supabase = fakeSupabase(pg)
    await pg.exec(
      'DELETE FROM public.synced_history; DELETE FROM public.synced_lexicon; DELETE FROM public.synced_meetings; DELETE FROM public.synced_history_deletions;'
    )
    // Alice already has two desktop entries, one phone entry, a word and a meeting.
    expect((await sync('alice-token', { history: [entry('desk-1', 1), entry('desk-2', 2)], lexicon: [word('w1', 'Wispra')], meetings: [meeting('m1')] })).status).toBe(200)
    await pg.query(
      "INSERT INTO public.synced_history (user_id, id, text, created_at) VALUES ($1, 'mobile-1', 'From the phone', '2026-10-06T09:00:00Z')",
      [ALICE]
    )
  })

  const untouched = async () => {
    expect(await historyOf(ALICE)).toEqual([
      { id: 'desk-1', text: 'Entry desk-1' },
      { id: 'desk-2', text: 'Entry desk-2' },
      { id: 'mobile-1', text: 'From the phone' },
    ])
    expect(await lexiconOf(ALICE)).toEqual([{ id: 'w1', term: 'Wispra' }])
    expect(await meetingIdsOf(ALICE)).toEqual(['m1'])
  }

  it('a malformed history no longer wipes the desktop entries before failing', async () => {
    const res = await sync('alice-token', { history: { 'desk-1': 'not an array' } })
    expect(res.status).toBe(400)
    await untouched()
  })

  it('one bad entry anywhere stops the whole request, with nothing written', async () => {
    const bodies = [
      { history: [entry('desk-3', 3), { id: 'desk-4', createdAt: 'yesterday', text: 'x' }] },
      { history: [entry('desk-3', 3), { id: 'desk-5' }] },
      { history: [entry('desk-3', 3), { ...entry('desk-6', 6), text: 'x'.repeat(100_001) }] },
      { history: [entry('desk-3', 3)], lexicon: [word('w2', '')] },
      { history: [entry('desk-3', 3)], lexicon: [word('w2', 'ok')], meetings: [{ id: 'm2' }] },
      { meetings: [meeting('m2', { durationMs: -1 })] },
      { meetings: 'm1' },
      [entry('desk-3', 3)],
      'not json',
    ]
    for (const body of bodies) {
      expect((await sync('alice-token', body)).status, JSON.stringify(body).slice(0, 80)).toBe(400)
    }
    await untouched()
  })

  it('has caps on how much one request may carry', async () => {
    const many = (n: number, make: (i: number) => unknown) => Array.from({ length: n }, (_, i) => make(i))
    expect((await sync('alice-token', { history: many(HISTORY_SYNC_MAX + 1, i => entry(`d${i}`, i % 60)) })).status).toBe(400)
    expect((await sync('alice-token', { lexicon: many(LEXICON_MAX + 1, i => word(`w${i}`, `T${i}`)) })).status).toBe(400)
    expect((await sync('alice-token', { meetings: many(MEETINGS_SYNC_MAX + 1, i => meeting(`m${i}`)) })).status).toBe(400)
    expect(invalidMeeting(meeting('big', { segments: [{ text: 'x'.repeat(3_000_001) }] }))).toMatch(/larger than/)
    await untouched()
  })

  it('still makes the cloud match the desktop snapshot, leaving phone entries alone', async () => {
    const res = await sync('alice-token', {
      history: [entry('desk-2', 2, 'Edited'), entry('desk-3', 3), { ...entry('mobile-1', 9), text: 'Desktop copy' }, entry('mobile-2', 10)],
    })
    expect(res.status).toBe(200)
    expect(await historyOf(ALICE)).toEqual([
      { id: 'desk-2', text: 'Edited' },
      { id: 'desk-3', text: 'Entry desk-3' },
      // The phone's own entry is never overwritten by the desktop's copy…
      { id: 'mobile-1', text: 'From the phone' },
      // …and a phone entry the cloud does not have yet is kept, as before.
      { id: 'mobile-2', text: 'Entry mobile-2' },
    ])
  })

  it('the same id twice keeps the last one instead of failing', async () => {
    const res = await sync('alice-token', { history: [entry('desk-1', 1, 'First'), entry('desk-1', 1, 'Second')] })
    expect(res.status).toBe(200)
    expect((await historyOf(ALICE)).filter(r => r.id === 'desk-1')).toEqual([{ id: 'desk-1', text: 'Second' }])
  })

  it('if writing fails part way, the old history and words are kept', async () => {
    const real = fakeSupabase(pg)
    const failing = (table: string) => ({
      ...real.from(table),
      upsert: () => ({ then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { message: 'connection reset' } }).then(resolve) }),
    })
    state.supabase = { ...real, from: (t: string) => (t === 'synced_history' || t === 'synced_lexicon' ? failing(t) : real.from(t)) }

    expect((await sync('alice-token', { history: [entry('desk-9', 9)] })).status).toBe(500)
    expect((await sync('alice-token', { lexicon: [word('w9', 'Nine')] })).status).toBe(500)

    state.supabase = real
    await untouched()
  })

  it('an empty snapshot still removes the desktop entries and words, never the phone entry', async () => {
    expect((await sync('alice-token', { history: [], lexicon: [] })).status).toBe(200)
    expect(await historyOf(ALICE)).toEqual([{ id: 'mobile-1', text: 'From the phone' }])
    expect(await lexiconOf(ALICE)).toEqual([])
  })

  it('one account’s sync never touches another account', async () => {
    expect((await sync('bob-token', { history: [entry('desk-1', 1, 'Bob')], lexicon: [word('w1', 'Bob word')], meetings: [meeting('m1', { title: 'Bob' })] })).status).toBe(200)
    expect((await sync('bob-token', { history: [], lexicon: [] })).status).toBe(200)
    await untouched()
  })
})
