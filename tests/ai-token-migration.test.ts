import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createTestDb, queryAs, readMigration, tokensUsed } from './helpers/test-db'

const USER_A = '00000000-0000-4000-8000-00000000000a'
const USER_B = '00000000-0000-4000-8000-00000000000b'

const increment = async (pg: PGlite, userId: string, month: string, tokens: number) => {
  const res = await pg.query<{ total: number | string }>(
    'SELECT public.increment_ai_tokens($1, $2, $3) AS total',
    [userId, month, tokens]
  )
  return Number(res.rows[0].total)
}

describe('migration 005_ai_token_usage', () => {
  let pg: PGlite

  beforeAll(async () => {
    pg = await createTestDb()
    await pg.query('INSERT INTO auth.users (id) VALUES ($1), ($2)', [USER_A, USER_B])
  })
  afterAll(() => pg.close())

  it('creates the row on first use and returns the running total', async () => {
    expect(await increment(pg, USER_A, '2026-10', 1200)).toBe(1200)
    expect(await increment(pg, USER_A, '2026-10', 800)).toBe(2000)
    expect(await tokensUsed(pg, USER_A, '2026-10')).toBe(2000)
  })

  it('keeps months and users apart', async () => {
    expect(await increment(pg, USER_A, '2026-11', 50)).toBe(50)
    expect(await increment(pg, USER_B, '2026-10', 7)).toBe(7)
    expect(await tokensUsed(pg, USER_A, '2026-10')).toBe(2000)
  })

  it('does not lose tokens when many increments are fired together', async () => {
    await Promise.all(Array.from({ length: 50 }, () => increment(pg, USER_B, '2026-12', 1000)))
    expect(await tokensUsed(pg, USER_B, '2026-12')).toBe(50_000)
  })

  it('holds totals above the 32-bit integer range', async () => {
    expect(await increment(pg, USER_B, '2027-01', 3_000_000_000)).toBe(3_000_000_000)
  })

  it('never subtracts: a negative amount counts as 0', async () => {
    expect(await increment(pg, USER_A, '2026-10', -500)).toBe(2000)
  })

  it('removes usage when the user is deleted', async () => {
    const gone = '00000000-0000-4000-8000-00000000000c'
    await pg.query('INSERT INTO auth.users (id) VALUES ($1)', [gone])
    await increment(pg, gone, '2026-10', 10)
    await pg.query('DELETE FROM auth.users WHERE id = $1', [gone])
    expect(await tokensUsed(pg, gone, '2026-10')).toBeNull()
  })

  it('is closed to anon and authenticated, open to service_role', async () => {
    const rls = await pg.query<{ relrowsecurity: boolean }>(
      "SELECT relrowsecurity FROM pg_class WHERE oid = 'public.ai_token_usage'::regclass"
    )
    expect(rls.rows[0].relrowsecurity).toBe(true)

    const call = 'SELECT public.increment_ai_tokens($1, $2, $3) AS total'
    for (const role of ['anon', 'authenticated'] as const) {
      await expect(queryAs(pg, role, call, [USER_A, '2026-10', 1])).rejects.toThrow(/permission denied/)
      // RLS with no policies: the rows are there, but these roles see none and cannot add any.
      const seen = await queryAs<{ n: number }>(pg, role, 'SELECT count(*)::int AS n FROM public.ai_token_usage')
      expect(seen.rows[0].n).toBe(0)
      await expect(
        queryAs(pg, role, 'INSERT INTO public.ai_token_usage (user_id, month) VALUES ($1, $2)', [USER_A, '2030-01'])
      ).rejects.toThrow(/row-level security/)
    }
    expect(await tokensUsed(pg, USER_A, '2026-10')).toBe(2000)

    const asServer = await queryAs<{ total: number | string }>(pg, 'service_role', call, [USER_A, '2031-01', 5])
    expect(Number(asServer.rows[0].total)).toBe(5)
  })

  it('leaves the existing usage table and function untouched', async () => {
    await pg.query('SELECT public.increment_usage($1, $2, $3)', [USER_A, '2026-10', 90])
    const res = await pg.query<{ seconds_used: number }>(
      'SELECT seconds_used FROM public.usage WHERE user_id = $1 AND month = $2',
      [USER_A, '2026-10']
    )
    expect(res.rows[0].seconds_used).toBe(90)
  })

  it('can be applied twice without error or data loss', async () => {
    await pg.exec(readMigration('005_ai_token_usage.sql'))
    expect(await tokensUsed(pg, USER_A, '2026-10')).toBe(2000)
  })
})
