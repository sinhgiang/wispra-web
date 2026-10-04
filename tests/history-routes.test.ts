import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { PGlite } from '@electric-sql/pglite'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createProductionLikeDb, fakeSupabase, queryAs } from './helpers/test-db'

const ALICE = '00000000-0000-4000-8000-0000000000a1'
const BOB = '00000000-0000-4000-8000-0000000000b2'
const TOKENS: Record<string, string> = { 'alice-token': ALICE, 'bob-token': BOB }

const state = vi.hoisted(() => ({ supabase: null as unknown }))

vi.mock('@/lib/supabase-server', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/supabase-server')>()),
  createAdminClient: () => state.supabase as SupabaseClient,
  validateToken: async (token: string) => TOKENS[token] ?? null,
}))

import { GET as readHistory } from '@/app/api/history/route'
import { POST as mergeHistory } from '@/app/api/history/merge/route'
import { POST as desktopSync } from '@/app/api/sync/route'

const auth = (token?: string): Record<string, string> => (token ? { authorization: `Bearer ${token}` } : {})

const read = (token?: string, query = '') =>
  readHistory(new NextRequest(`http://localhost/api/history${query}`, { headers: auth(token) }))

const merge = (token: string | undefined, body: unknown) =>
  mergeHistory(
    new NextRequest('http://localhost/api/history/merge', {
      method: 'POST',
      headers: { ...auth(token), 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  )

const sync = (token: string, body: unknown) =>
  desktopSync(
    new NextRequest('http://localhost/api/sync', {
      method: 'POST',
      headers: { ...auth(token), 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  )

const entry = (id: string, minute: number, text = `Entry ${id}`) => ({
  id,
  text,
  rawText: `raw ${text}`,
  createdAt: `2026-10-05T08:${String(minute).padStart(2, '0')}:00.000Z`,
  app: 'Notes',
  topic: 'General',
  language: 'en',
  durationSeconds: 4.5,
})

const ids = async (token: string) => ((await (await read(token)).json()).entries as { id: string }[]).map(e => e.id)

describe('GET /api/history and POST /api/history/merge', () => {
  let pg: PGlite

  beforeAll(async () => {
    pg = await createProductionLikeDb()
    await queryAs(pg, 'supabase_auth_admin', 'INSERT INTO auth.users (id) VALUES ($1), ($2)', [ALICE, BOB])
    state.supabase = fakeSupabase(pg)
  })
  afterAll(() => pg.close())

  beforeEach(async () => {
    await pg.exec('DELETE FROM public.synced_history')
    // The desktop app's history, sent the way it does today.
    const res = await sync('alice-token', { history: [entry('desk-1', 1), entry('desk-2', 2), entry('desk-3', 3)] })
    expect(res.status).toBe(200)
  })

  it('reads the signed-in user’s history, newest first, in the same shape the desktop sends', async () => {
    const res = await read('alice-token')
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.nextBefore).toBeNull()
    expect(body.entries.map((e: { id: string }) => e.id)).toEqual(['desk-3', 'desk-2', 'desk-1'])
    expect(body.entries[0]).toEqual({ ...entry('desk-3', 3), syncedAt: expect.any(String) })
  })

  it('merging from the phone adds and updates entries and keeps every desktop entry', async () => {
    const res = await merge('alice-token', {
      entries: [entry('phone-1', 10, 'Said on the phone'), entry('phone-2', 11), { ...entry('desk-2', 2), text: 'Edited on the phone' }],
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, merged: 3 })
    expect(await ids('alice-token')).toEqual(['phone-2', 'phone-1', 'desk-3', 'desk-2', 'desk-1'])
    const all = (await (await read('alice-token')).json()).entries as { id: string; text: string }[]
    expect(all.find(e => e.id === 'desk-2')?.text).toBe('Edited on the phone')
    expect(all.find(e => e.id === 'desk-1')?.text).toBe('Entry desk-1')
  })

  it('merging the same entries again changes nothing', async () => {
    const batch = { entries: [entry('phone-1', 10), entry('phone-2', 11)] }
    await merge('alice-token', batch)
    await merge('alice-token', batch)

    expect(await ids('alice-token')).toEqual(['phone-2', 'phone-1', 'desk-3', 'desk-2', 'desk-1'])
  })

  it('another user can neither read nor change someone else’s history', async () => {
    expect((await (await read('bob-token')).json()).entries).toEqual([])

    // Bob sends an entry with Alice's id and her user id in the body: it becomes Bob's own entry.
    const res = await merge('bob-token', { entries: [{ ...entry('desk-1', 1, 'Bob wrote this'), userId: ALICE, user_id: ALICE }] })
    expect(res.status).toBe(200)

    const alice = (await (await read('alice-token')).json()).entries as { id: string; text: string }[]
    expect(alice.find(e => e.id === 'desk-1')?.text).toBe('Entry desk-1')
    expect(alice).toHaveLength(3)
    expect(await ids('bob-token')).toEqual(['desk-1'])
  })

  it('both routes refuse a missing or invalid sign-in', async () => {
    expect((await read()).status).toBe(401)
    expect((await read('stolen-token')).status).toBe(401)
    expect((await merge(undefined, { entries: [entry('x', 1)] })).status).toBe(401)
    expect((await merge('stolen-token', { entries: [entry('x', 1)] })).status).toBe(401)
    expect(await ids('alice-token')).toEqual(['desk-3', 'desk-2', 'desk-1'])
  })

  it('pages to older entries with limit and nextBefore', async () => {
    const first = await (await read('alice-token', '?limit=2')).json()
    expect(first.entries.map((e: { id: string }) => e.id)).toEqual(['desk-3', 'desk-2'])
    expect(first.nextBefore).toBe('2026-10-05T08:02:00.000Z')

    const second = await (await read('alice-token', `?limit=2&before=${encodeURIComponent(first.nextBefore)}`)).json()
    expect(second.entries.map((e: { id: string }) => e.id)).toEqual(['desk-1'])
    expect(second.nextBefore).toBeNull()
  })

  it('rejects bad input without storing anything', async () => {
    expect((await read('alice-token', '?limit=0')).status).toBe(400)
    expect((await read('alice-token', '?limit=501')).status).toBe(400)
    expect((await read('alice-token', '?before=yesterday')).status).toBe(400)

    expect((await merge('alice-token', 'not json')).status).toBe(400)
    expect((await merge('alice-token', { entries: [] })).status).toBe(400)
    expect((await merge('alice-token', { entries: Array.from({ length: 501 }, (_, i) => entry(`p${i}`, 1)) })).status).toBe(400)
    const bad = await merge('alice-token', { entries: [entry('ok', 1), { ...entry('bad', 2), createdAt: 'soon' }] })
    expect(bad.status).toBe(400)
    expect((await bad.json()).error).toContain('entries[1]')
    expect((await merge('alice-token', { entries: [{ ...entry('', 1) }] })).status).toBe(400)
    expect((await merge('alice-token', { entries: [{ ...entry('neg', 1), durationSeconds: -1 }] })).status).toBe(400)

    expect(await ids('alice-token')).toEqual(['desk-3', 'desk-2', 'desk-1'])
  })

  it('the same id twice in one request is stored once (the last one wins)', async () => {
    const res = await merge('alice-token', { entries: [entry('phone-1', 10, 'first'), entry('phone-1', 10, 'second')] })
    expect(await res.json()).toEqual({ ok: true, merged: 1 })
    const all = (await (await read('alice-token')).json()).entries as { id: string; text: string }[]
    expect(all.filter(e => e.id === 'phone-1').map(e => e.text)).toEqual(['second'])
  })
})

describe('/api/sync is unchanged', () => {
  let pg: PGlite

  beforeAll(async () => {
    pg = await createProductionLikeDb()
    await queryAs(pg, 'supabase_auth_admin', 'INSERT INTO auth.users (id) VALUES ($1)', [ALICE])
    state.supabase = fakeSupabase(pg)
  })
  afterAll(() => pg.close())

  it('still replaces the whole history with what the desktop sends', async () => {
    await sync('alice-token', { history: [entry('desk-1', 1), entry('desk-2', 2)] })
    const res = await sync('alice-token', { history: [entry('desk-9', 9)] })

    expect(await res.json()).toEqual({ ok: true, synced: { history: 1, lexicon: 0, meetings: 0 } })
    expect(await ids('alice-token')).toEqual(['desk-9'])
  })

  it('KNOWN CONFLICT: the next desktop sync removes entries merged from the phone', async () => {
    await sync('alice-token', { history: [entry('desk-1', 1)] })
    await merge('alice-token', { entries: [entry('phone-1', 10)] })
    expect(await ids('alice-token')).toEqual(['phone-1', 'desk-1'])

    // The desktop sends its local snapshot, which does not contain the phone's entry.
    await sync('alice-token', { history: [entry('desk-1', 1), entry('desk-2', 2)] })

    expect(await ids('alice-token')).toEqual(['desk-2', 'desk-1'])
  })
})
