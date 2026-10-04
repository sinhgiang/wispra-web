import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { PGlite } from '@electric-sql/pglite'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createProductionLikeDb, fakeSupabase, queryAs } from './helpers/test-db'

const ALICE = '00000000-0000-4000-8000-0000000000a1'

const state = vi.hoisted(() => ({ supabase: null as unknown }))

vi.mock('@/lib/supabase-server', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/supabase-server')>()),
  createAdminClient: () => state.supabase as SupabaseClient,
  validateToken: async (token: string) => (token === 'alice-token' ? ALICE : null),
}))

import { GET as readHistory, DELETE as deleteAll } from '@/app/api/history/route'
import { POST as mergeHistory } from '@/app/api/history/merge/route'
import { POST as desktopSync } from '@/app/api/sync/route'
import { getDeletions } from '@/lib/history-deletions'
import { readAllPages } from '@/lib/supabase-paging'

const WITH_008 = [
  '002_sync.sql',
  '003_mcp_tokens.sql',
  '004_mcp_token_expiry.sql',
  '005_ai_token_usage.sql',
  '006_lock_increment_usage.sql',
  '007_unlimited_accounts.sql',
  '008_history_deletions.sql',
]

const headers = { authorization: 'Bearer alice-token', 'content-type': 'application/json' }
const read = async (query = '') => (await readHistory(new NextRequest(`http://localhost/api/history${query}`, { headers }))).json()
const sync = (history: unknown[]) =>
  desktopSync(new NextRequest('http://localhost/api/sync', { method: 'POST', headers, body: JSON.stringify({ history }) }))
const merge = (entries: unknown[]) =>
  mergeHistory(new NextRequest('http://localhost/api/history/merge', { method: 'POST', headers, body: JSON.stringify({ entries }) }))
const clearAll = () =>
  deleteAll(new NextRequest('http://localhost/api/history', { method: 'DELETE', headers, body: JSON.stringify({ all: true }) }))

const entry = (id: string, createdAt = '2026-10-05T08:00:00.000Z') => ({ id, text: `Entry ${id}`, createdAt })
const pad = (n: number) => String(n).padStart(4, '0')

/** 1,500 deletion marks, oldest first, then a "delete everything" mark as the newest row. */
const seedDeletions = async (pg: PGlite) => {
  await pg.query(
    `INSERT INTO public.synced_history_deletions (user_id, id, deleted_at)
     SELECT $1, CASE WHEN n % 2 = 0 THEN 'desk-' ELSE 'mobile-' END || lpad(n::text, 4, '0'),
            timestamptz '2026-10-05 09:00:00+00' + n * interval '1 second'
     FROM generate_series(1, 1500) AS n`,
    [ALICE]
  )
  await pg.query(
    "INSERT INTO public.synced_history_deletions (user_id, id, deleted_at) VALUES ($1, '*', timestamptz '2026-10-05 11:00:00+00')",
    [ALICE]
  )
}

describe('more than 1,000 deletion marks (Supabase returns 1,000 rows per select)', () => {
  let pg: PGlite

  beforeAll(async () => {
    pg = await createProductionLikeDb(WITH_008)
    await queryAs(pg, 'supabase_auth_admin', 'INSERT INTO auth.users (id) VALUES ($1)', [ALICE])
  })
  afterAll(() => pg.close())

  beforeEach(async () => {
    await pg.exec('DELETE FROM public.synced_history; DELETE FROM public.synced_history_deletions;')
    state.supabase = fakeSupabase(pg)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-05T12:00:00Z'))
  })
  afterEach(() => vi.useRealTimers())

  it('the fake cuts an unpaged select at 1,000 rows, like Supabase', async () => {
    await seedDeletions(pg)
    const { data } = await (state.supabase as SupabaseClient).from('synced_history_deletions').select('id').eq('user_id', ALICE)
    expect(data).toHaveLength(1000)
  })

  it('reads every mark, including the clear stored after the first 1,000 rows', async () => {
    await seedDeletions(pg)

    const result = await getDeletions(state.supabase as SupabaseClient, ALICE)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.deletions.entries).toHaveLength(1500)
    expect(result.deletions.ids.has('desk-1500')).toBe(true)
    expect(result.deletions.clearedAt).toBe('2026-10-05T11:00:00.000Z')
  })

  it('no deleted entry comes back through the desktop sync or the phone merge', async () => {
    await seedDeletions(pg)
    // Deleted ids from the first page, the last page, and the very last one; stamped
    // after the clear so only their own marks can stop them.
    const after = '2026-10-05T11:30:00.000Z'
    const deskDeleted = ['desk-0002', 'desk-1000', 'desk-1200', 'desk-1500'].map(id => entry(id, after))
    const phoneDeleted = ['mobile-0001', 'mobile-1001', 'mobile-1499'].map(id => entry(id, after))

    const synced = await (await sync([...deskDeleted, entry('desk-new', after)])).json()
    const merged = await (await merge([...phoneDeleted, entry('mobile-new', after)])).json()

    expect(synced).toMatchObject({ synced: { history: 1 }, historySkipped: 4 })
    expect(merged).toEqual({ ok: true, merged: 1, skippedDeleted: 3 })
    // An old entry the server never saw is stopped by the clear stored after row 1,000.
    expect(await (await sync([entry('desk-old', '2026-10-05T08:00:00.000Z')])).json()).toMatchObject({ historySkipped: 1 })

    const ids = ((await read()).entries as { id: string }[]).map(e => e.id).sort()
    expect(ids).toEqual(['mobile-new'])
  })

  it('GET /api/history lists every deletion and the clear', async () => {
    await seedDeletions(pg)

    const all = await read()
    expect(all.deleted).toHaveLength(1500)
    expect(all.deleted[1499]).toEqual({ id: 'desk-1500', deletedAt: '2026-10-05T09:25:00.000Z' })
    expect(all.clearedAt).toBe('2026-10-05T11:00:00.000Z')

    const recent = await read(`?since=${encodeURIComponent('2026-10-05T09:24:59.000Z')}`)
    expect(recent.deleted.map((d: { id: string }) => d.id)).toEqual(['mobile-1499', 'desk-1500'])
  })

  it('deleting everything with 1,200 entries counts 1,200 and marks every one of them', async () => {
    await pg.query(
      `INSERT INTO public.synced_history (user_id, id, text, created_at)
       SELECT $1, 'mobile-' || lpad(n::text, 4, '0'), 'x', timestamptz '2026-10-05 11:59:00+00'
       FROM generate_series(1, 1200) AS n`,
      [ALICE]
    )

    const res = await clearAll()

    expect(await res.json()).toEqual({ ok: true, deleted: 1200, clearedAt: '2026-10-05T12:00:00.000Z' })
    const marks = await pg.query<{ n: number }>('SELECT count(*)::int AS n FROM public.synced_history_deletions WHERE user_id = $1', [ALICE])
    expect(marks.rows[0].n).toBe(1201)
    // Entries created a minute before the clear (inside the 5-minute margin) are
    // stopped by their own marks, including those beyond the first 1,000.
    const back = await (await merge([entry('mobile-0001', '2026-10-05T11:59:00.000Z'), entry(`mobile-${pad(1200)}`, '2026-10-05T11:59:00.000Z')])).json()
    expect(back).toEqual({ ok: true, merged: 0, skippedDeleted: 2 })
    expect((await read()).entries).toEqual([])
  })

  it('reads everything even when the server returns fewer rows per page than asked', async () => {
    await seedDeletions(pg)
    const small = fakeSupabase(pg, { maxRows: 300 })

    const { data, error } = await readAllPages<{ id: string }, { message: string }>((from, to) =>
      small.from('synced_history_deletions').select('id').eq('user_id', ALICE).order('id', { ascending: true }).range(from, to)
    )

    expect(error).toBeNull()
    expect(data).toHaveLength(1501)
    expect(new Set(data!.map(r => r.id)).size).toBe(1501)
  })
})
