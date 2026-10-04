import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
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

import { GET as readHistory, DELETE as deleteAll } from '@/app/api/history/route'
import { DELETE as deleteOne } from '@/app/api/history/[id]/route'
import { POST as mergeHistory } from '@/app/api/history/merge/route'
import { POST as desktopSync } from '@/app/api/sync/route'

const WITH_008 = [
  '002_sync.sql',
  '003_mcp_tokens.sql',
  '004_mcp_token_expiry.sql',
  '005_ai_token_usage.sql',
  '006_lock_increment_usage.sql',
  '007_unlimited_accounts.sql',
  '008_history_deletions.sql',
]

const auth = (token?: string): Record<string, string> => (token ? { authorization: `Bearer ${token}` } : {})
const json = { 'content-type': 'application/json' }

const read = async (token: string, query = '') =>
  (await readHistory(new NextRequest(`http://localhost/api/history${query}`, { headers: auth(token) }))).json()

const removeOne = (token: string | undefined, id: string) =>
  deleteOne(new NextRequest(`http://localhost/api/history/${encodeURIComponent(id)}`, { method: 'DELETE', headers: auth(token) }), {
    params: Promise.resolve({ id }),
  })

const removeAll = (token: string | undefined, body?: unknown) =>
  deleteAll(
    new NextRequest('http://localhost/api/history', {
      method: 'DELETE',
      headers: { ...auth(token), ...json },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  )

const merge = (token: string, entries: unknown[]) =>
  mergeHistory(new NextRequest('http://localhost/api/history/merge', { method: 'POST', headers: { ...auth(token), ...json }, body: JSON.stringify({ entries }) }))

const sync = (token: string, history: unknown[]) =>
  desktopSync(new NextRequest('http://localhost/api/sync', { method: 'POST', headers: { ...auth(token), ...json }, body: JSON.stringify({ history }) }))

const entry = (id: string, minute: number) => ({
  id,
  text: `Entry ${id}`,
  createdAt: `2026-10-05T08:${String(minute).padStart(2, '0')}:00.000Z`,
})

const ids = async (token: string) => ((await read(token)).entries as { id: string }[]).map(e => e.id)

describe('deleting history on every device', () => {
  let pg: PGlite

  beforeAll(async () => {
    pg = await createProductionLikeDb(WITH_008)
    await queryAs(pg, 'supabase_auth_admin', 'INSERT INTO auth.users (id) VALUES ($1), ($2)', [ALICE, BOB])
    state.supabase = fakeSupabase(pg)
  })
  afterAll(() => pg.close())

  beforeEach(async () => {
    await pg.exec('DELETE FROM public.synced_history; DELETE FROM public.synced_history_deletions;')
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-05T12:00:00Z'))
    // Alice's desktop and phone entries.
    await sync('alice-token', [entry('desk-1', 1), entry('desk-2', 2)])
    await merge('alice-token', [entry('mobile-1', 10), entry('mobile-2', 11)])
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('deletes one entry, desktop or phone, and says how many were deleted', async () => {
    const res = await removeOne('alice-token', 'desk-1')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, deleted: 1 })

    expect(await (await removeOne('alice-token', 'mobile-2')).json()).toEqual({ ok: true, deleted: 1 })
    expect(await ids('alice-token')).toEqual(['mobile-1', 'desk-2'])
  })

  it('another device gets the deleted ids from GET /api/history, and only the new ones when it passes since', async () => {
    const before = await read('alice-token')
    expect(before.deleted).toEqual([])
    expect(before.clearedAt).toBeNull()
    expect(before.serverTime).toBe('2026-10-05T12:00:00.000Z')

    vi.setSystemTime(new Date('2026-10-05T12:05:00Z'))
    await removeOne('alice-token', 'desk-1')
    vi.setSystemTime(new Date('2026-10-05T12:06:00Z'))
    await removeOne('alice-token', 'mobile-1')

    const after = await read('alice-token', `?since=${encodeURIComponent(before.serverTime)}`)
    expect(after.deleted).toEqual([
      { id: 'desk-1', deletedAt: '2026-10-05T12:05:00.000Z' },
      { id: 'mobile-1', deletedAt: '2026-10-05T12:06:00.000Z' },
    ])
    expect(after.serverTime).toBe('2026-10-05T12:06:00.000Z')

    vi.setSystemTime(new Date('2026-10-05T12:10:00Z'))
    await removeOne('alice-token', 'mobile-2')
    const next = await read('alice-token', `?since=${encodeURIComponent('2026-10-05T12:06:30.000Z')}`)
    expect(next.deleted).toEqual([{ id: 'mobile-2', deletedAt: '2026-10-05T12:10:00.000Z' }])
  })

  it('a deleted entry does not come back through the desktop sync', async () => {
    await removeOne('alice-token', 'desk-1')

    // The desktop has not heard of the deletion and sends desk-1 again.
    const res = await sync('alice-token', [entry('desk-1', 1), entry('desk-2', 2), entry('desk-3', 3)])

    expect(await res.json()).toEqual({ ok: true, synced: { history: 2, lexicon: 0, meetings: 0 }, historySkipped: 1 })
    expect(await ids('alice-token')).toEqual(['mobile-2', 'mobile-1', 'desk-3', 'desk-2'])
  })

  it('a deleted phone entry does not come back through another phone’s merge', async () => {
    await removeOne('alice-token', 'mobile-1')

    const res = await merge('alice-token', [entry('mobile-1', 10), entry('mobile-3', 12)])

    expect(await res.json()).toEqual({ ok: true, merged: 1, skippedDeleted: 1 })
    expect(await ids('alice-token')).toEqual(['mobile-3', 'mobile-2', 'desk-2', 'desk-1'])
  })

  it('an entry deleted before it ever reached the cloud is still kept out', async () => {
    const res = await removeOne('alice-token', 'desk-9')
    expect(await res.json()).toEqual({ ok: true, deleted: 0 })

    await sync('alice-token', [entry('desk-1', 1), entry('desk-9', 9)])
    expect(await ids('alice-token')).not.toContain('desk-9')
  })

  it('another user cannot delete someone else’s entries', async () => {
    await sync('bob-token', [entry('desk-1', 1)])

    // Bob deletes "desk-1": only his own entry with that id goes.
    expect(await (await removeOne('bob-token', 'desk-1')).json()).toEqual({ ok: true, deleted: 1 })
    expect(await (await removeOne('bob-token', 'mobile-1')).json()).toEqual({ ok: true, deleted: 0 })
    expect(await (await removeAll('bob-token', { all: true })).json()).toMatchObject({ ok: true, deleted: 0 })

    expect(await ids('alice-token')).toEqual(['mobile-2', 'mobile-1', 'desk-2', 'desk-1'])
    expect((await read('alice-token')).deleted).toEqual([])
    expect((await read('alice-token')).clearedAt).toBeNull()
    // Bob's deletions do not stop Alice's desktop from syncing desk-1.
    await sync('alice-token', [entry('desk-1', 1), entry('desk-2', 2)])
    expect(await ids('alice-token')).toContain('desk-1')
  })

  it('both delete routes refuse a missing or invalid sign-in, and delete nothing', async () => {
    expect((await removeOne(undefined, 'desk-1')).status).toBe(401)
    expect((await removeOne('stolen-token', 'desk-1')).status).toBe(401)
    expect((await removeAll(undefined, { all: true })).status).toBe(401)
    expect((await removeAll('stolen-token', { all: true })).status).toBe(401)
    expect(await ids('alice-token')).toEqual(['mobile-2', 'mobile-1', 'desk-2', 'desk-1'])
  })

  it('deleting everything needs { "all": true } exactly', async () => {
    for (const body of [undefined, {}, { all: 'true' }, { all: 1 }]) {
      expect((await removeAll('alice-token', body)).status).toBe(400)
    }
    expect((await removeOne('alice-token', '*')).status).toBe(400)
    expect(await ids('alice-token')).toHaveLength(4)
  })

  it('deleting everything clears every device, and old entries cannot come back', async () => {
    vi.setSystemTime(new Date('2026-10-05T12:30:00Z'))
    const res = await removeAll('alice-token', { all: true })

    expect(await res.json()).toEqual({ ok: true, deleted: 4, clearedAt: '2026-10-05T12:30:00.000Z' })
    const after = await read('alice-token')
    expect(after.entries).toEqual([])
    expect(after.clearedAt).toBe('2026-10-05T12:30:00.000Z')

    // A desktop and a phone that missed the clear send old entries again, plus one new each.
    await sync('alice-token', [entry('desk-1', 1), { ...entry('desk-new', 1), createdAt: '2026-10-05T12:31:00.000Z' }])
    await merge('alice-token', [entry('mobile-1', 10), { ...entry('mobile-new', 1), createdAt: '2026-10-05T12:32:00.000Z' }])

    expect(await ids('alice-token')).toEqual(['mobile-new', 'desk-new'])
  })

  it('if the deletion cannot be recorded, nothing is deleted', async () => {
    const without008 = await createProductionLikeDb(WITH_008.slice(0, -1))
    try {
      await queryAs(without008, 'supabase_auth_admin', 'INSERT INTO auth.users (id) VALUES ($1)', [ALICE])
      state.supabase = fakeSupabase(without008)
      vi.spyOn(console, 'error').mockImplementation(() => {})
      await sync('alice-token', [entry('desk-1', 1)])

      expect((await removeOne('alice-token', 'desk-1')).status).toBe(500)
      expect((await removeAll('alice-token', { all: true })).status).toBe(500)
      expect(await ids('alice-token')).toEqual(['desk-1'])
      // Reading still works before migration 008 is applied.
      expect(await read('alice-token')).toMatchObject({ deleted: [], clearedAt: null })
    } finally {
      state.supabase = fakeSupabase(pg)
      await without008.close()
    }
  })
})

describe('migration 008_history_deletions', () => {
  let pg: PGlite

  beforeAll(async () => {
    pg = await createProductionLikeDb(WITH_008)
    await queryAs(pg, 'supabase_auth_admin', 'INSERT INTO auth.users (id) VALUES ($1)', [ALICE])
  })
  afterAll(() => pg.close())

  it('adds the table with its key, RLS on and no policies; anon and signed-in users see nothing', async () => {
    await pg.query("INSERT INTO public.synced_history_deletions (user_id, id) VALUES ($1, 'desk-1')", [ALICE])

    const rls = await pg.query<{ relrowsecurity: boolean }>("SELECT relrowsecurity FROM pg_class WHERE oid = 'public.synced_history_deletions'::regclass")
    expect(rls.rows[0].relrowsecurity).toBe(true)
    const policies = await pg.query("SELECT 1 FROM pg_policies WHERE tablename = 'synced_history_deletions'")
    expect(policies.rows).toHaveLength(0)
    const key = await pg.query<{ def: string }>("SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = 'public.synced_history_deletions'::regclass AND contype = 'p'")
    expect(key.rows[0].def).toBe('PRIMARY KEY (user_id, id)')

    for (const role of ['anon', 'authenticated']) {
      const seen = await queryAs<{ n: number }>(pg, role, 'SELECT count(*)::int AS n FROM public.synced_history_deletions')
      expect(seen.rows[0].n).toBe(0)
    }
  })

  it('removes a user’s deletions with the user, and can be applied twice', async () => {
    await pg.exec(readMigration('008_history_deletions.sql'))
    await pg.query('DELETE FROM auth.users WHERE id = $1', [ALICE])
    const left = await pg.query('SELECT 1 FROM public.synced_history_deletions WHERE user_id = $1', [ALICE])
    expect(left.rows).toHaveLength(0)
  })
})
