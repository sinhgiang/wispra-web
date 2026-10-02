import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createTestDb, queryAs, readMigration } from './helpers/test-db'

const USER = '00000000-0000-4000-8000-00000000000a'
const CALL = 'SELECT public.increment_usage($1, $2, $3)'
const ROLES = ['anon', 'authenticated', 'service_role'] as const

const secondsUsed = async (pg: PGlite, month: string) => {
  const res = await pg.query<{ seconds_used: number }>(
    'SELECT seconds_used FROM public.usage WHERE user_id = $1 AND month = $2',
    [USER, month]
  )
  return res.rows[0]?.seconds_used ?? null
}

const canCall = async (pg: PGlite, fn: string) => {
  const res = await pg.query<{ role: string; can_call: boolean }>(
    `SELECT r AS role, has_function_privilege(r, $1, 'EXECUTE') AS can_call
     FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) AS r`,
    [fn]
  )
  return Object.fromEntries(res.rows.map(row => [row.role, row.can_call]))
}

describe('migration 006_lock_increment_usage', () => {
  let pg: PGlite

  beforeAll(async () => {
    pg = await createTestDb(['001_initial.sql', '005_ai_token_usage.sql'])
    await pg.query('INSERT INTO auth.users (id) VALUES ($1)', [USER])
  })
  afterAll(() => pg.close())

  it('before: reproduces the hole, anon and authenticated can inflate a user', async () => {
    expect(await canCall(pg, 'public.increment_usage(uuid, text, integer)')).toEqual({
      anon: true,
      authenticated: true,
      service_role: true,
    })
    await queryAs(pg, 'anon', CALL, [USER, '2026-10', 1800])
    await queryAs(pg, 'authenticated', CALL, [USER, '2026-10', 1800])
    expect(await secondsUsed(pg, '2026-10')).toBe(3600)
  })

  it('after: anon and authenticated are refused and nothing is counted', async () => {
    await pg.exec(readMigration('006_lock_increment_usage.sql'))

    expect(await canCall(pg, 'public.increment_usage(uuid, text, integer)')).toEqual({
      anon: false,
      authenticated: false,
      service_role: true,
    })
    for (const role of ['anon', 'authenticated'] as const) {
      await expect(queryAs(pg, role, CALL, [USER, '2026-11', 1800])).rejects.toThrow(
        /permission denied for function increment_usage/
      )
    }
    expect(await secondsUsed(pg, '2026-11')).toBeNull()
  })

  it('after: the server (service role) still records usage', async () => {
    await queryAs(pg, 'service_role', CALL, [USER, '2026-11', 42])
    await queryAs(pg, 'service_role', CALL, [USER, '2026-11', 8])
    expect(await secondsUsed(pg, '2026-11')).toBe(50)
  })

  it('touches nothing else: data, function body and other functions stay as they were', async () => {
    expect(await secondsUsed(pg, '2026-10')).toBe(3600)

    const fn = await pg.query<{ prosecdef: boolean; proconfig: string[]; prosrc: string }>(
      "SELECT prosecdef, proconfig, prosrc FROM pg_proc WHERE oid = 'public.increment_usage(uuid, text, integer)'::regprocedure"
    )
    expect(fn.rows[0].prosecdef).toBe(true)
    expect(fn.rows[0].proconfig).toEqual(['search_path=public'])
    expect(fn.rows[0].prosrc).toContain('ON CONFLICT (user_id, month)')

    expect(await canCall(pg, 'public.increment_ai_tokens(uuid, text, bigint)')).toEqual({
      anon: false,
      authenticated: false,
      service_role: true,
    })
  })

  it('can be applied twice', async () => {
    await pg.exec(readMigration('006_lock_increment_usage.sql'))
    for (const role of ROLES) {
      const call = queryAs(pg, role, CALL, [USER, '2026-12', 1])
      if (role === 'service_role') await call
      else await expect(call).rejects.toThrow(/permission denied/)
    }
    expect(await secondsUsed(pg, '2026-12')).toBe(1)
  })
})
