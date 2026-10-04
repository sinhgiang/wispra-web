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
import { CLEAR_CUTOFF_MARGIN_MS, isMissingTable } from '@/lib/history-deletions'

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

describe('when the deleted entries cannot be read', () => {
  let pg: PGlite

  /** The real fake, except that reading synced_history_deletions fails like a dropped connection. */
  const withBrokenDeletions = (code: string, message: string): SupabaseClient => {
    const real = fakeSupabase(pg)
    const failing = {
      select: () => failing,
      eq: () => failing,
      then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { code, message } }).then(resolve),
    }
    return { ...real, from: (table: string) => (table === 'synced_history_deletions' ? failing : real.from(table)) } as unknown as SupabaseClient
  }

  beforeAll(async () => {
    pg = await createProductionLikeDb(WITH_008)
    await queryAs(pg, 'supabase_auth_admin', 'INSERT INTO auth.users (id) VALUES ($1)', [ALICE])
  })
  afterAll(() => pg.close())

  beforeEach(async () => {
    await pg.exec('DELETE FROM public.synced_history; DELETE FROM public.synced_history_deletions;')
    state.supabase = fakeSupabase(pg)
    await sync('alice-token', [entry('desk-1', 1), entry('desk-2', 2)])
    await merge('alice-token', [entry('mobile-1', 10)])
    await removeOne('alice-token', 'desk-2')
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    state.supabase = fakeSupabase(pg)
    vi.restoreAllMocks()
  })

  const stored = async () =>
    (await pg.query<{ id: string }>('SELECT id FROM public.synced_history WHERE user_id = $1 ORDER BY id', [ALICE])).rows.map(r => r.id)

  it('a temporary database error stops the desktop sync before anything is deleted or written', async () => {
    state.supabase = withBrokenDeletions('08006', 'connection reset')

    const res = await sync('alice-token', [entry('desk-2', 2), entry('desk-3', 3)])

    expect(res.status).toBe(500)
    expect((await res.json()).error).toContain('connection reset')
    // desk-1 was not wiped, deleted desk-2 was not brought back, desk-3 was not added.
    expect(await stored()).toEqual(['desk-1', 'mobile-1'])
  })

  it('a temporary database error stops the phone merge without storing anything', async () => {
    state.supabase = withBrokenDeletions('57014', 'canceling statement due to statement timeout')

    const res = await merge('alice-token', [entry('mobile-2', 11)])

    expect(res.status).toBe(500)
    expect(await stored()).toEqual(['desk-1', 'mobile-1'])
  })

  it('a temporary database error fails the read, so a device does not move its `since` past deletions', async () => {
    state.supabase = withBrokenDeletions('08006', 'connection reset')

    const res = await readHistory(new NextRequest('http://localhost/api/history', { headers: auth('alice-token') }))

    expect(res.status).toBe(500)
  })

  it('only a missing table (before migration 008) counts as "nothing deleted"', async () => {
    expect(isMissingTable({ code: '42P01' })).toBe(true)
    expect(isMissingTable({ code: 'PGRST205' })).toBe(true)
    expect(isMissingTable({ code: '08006' })).toBe(false)
    expect(isMissingTable({ message: 'relation "public.synced_history_deletions" does not exist' })).toBe(false)

    state.supabase = withBrokenDeletions('PGRST205', "Could not find the table 'public.synced_history_deletions' in the schema cache")
    const res = await merge('alice-token', [entry('mobile-2', 11)])
    expect(res.status).toBe(200)
    expect(await stored()).toEqual(['desk-1', 'mobile-1', 'mobile-2'])
  })
})

describe('delete everything with clocks that disagree', () => {
  let pg: PGlite
  const at = (time: string) => `2026-10-05T${time}.000Z`
  const made = (id: string, time: string) => ({ id, text: `Entry ${id}`, createdAt: at(time) })

  beforeAll(async () => {
    pg = await createProductionLikeDb(WITH_008)
    await queryAs(pg, 'supabase_auth_admin', 'INSERT INTO auth.users (id) VALUES ($1)', [ALICE])
    state.supabase = fakeSupabase(pg)
  })
  afterAll(() => pg.close())

  beforeEach(async () => {
    state.supabase = fakeSupabase(pg)
    await pg.exec('DELETE FROM public.synced_history; DELETE FROM public.synced_history_deletions;')
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(at('12:00:00')))
    // In the cloud before the clear, including one stamped exactly at the clear time
    // by a device whose clock runs ahead.
    await sync('alice-token', [made('desk-1', '08:01:00'), made('desk-ahead', '12:30:00')])
    await merge('alice-token', [made('mobile-1', '12:29:30')])
    vi.setSystemTime(new Date(at('12:30:00')))
    await removeAll('alice-token', { all: true })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('every entry that was in the cloud stays deleted, whatever its time', async () => {
    const res = await sync('alice-token', [made('desk-1', '08:01:00'), made('desk-ahead', '12:30:00')])
    await merge('alice-token', [made('mobile-1', '12:29:30')])

    expect(await res.json()).toMatchObject({ synced: { history: 0 }, historySkipped: 2 })
    expect(await ids('alice-token')).toEqual([])
    const after = await read('alice-token')
    expect(after.deleted.map((d: { id: string }) => d.id).sort()).toEqual(['desk-1', 'desk-ahead', 'mobile-1'])
    expect(after.clearedAt).toBe(at('12:30:00'))
  })

  it('a new entry from a device whose clock runs a few minutes behind is kept', async () => {
    expect(CLEAR_CUTOFF_MARGIN_MS).toBe(5 * 60_000)
    vi.setSystemTime(new Date(at('12:31:00')))

    // Dictated after the clear on a laptop 3 minutes slow: stamped 12:28.
    await sync('alice-token', [made('desk-slow-clock', '12:28:00')])
    await merge('alice-token', [made('mobile-slow-clock', '12:26:00')])

    expect(await ids('alice-token')).toEqual(['desk-slow-clock', 'mobile-slow-clock'])
  })

  it('an entry the server never saw, from well before the clear, is dropped', async () => {
    // Dictated offline long before the clear and sent only now.
    await sync('alice-token', [made('desk-offline', '12:20:00'), made('desk-edge', '12:25:00')])

    expect(await ids('alice-token')).toEqual([])
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
