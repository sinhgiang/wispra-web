import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createProductionLikeDb, createTestDb, fakeSupabase, queryAs, readMigration } from './helpers/test-db'
import { getAiQuotaStatus } from '@/lib/ai-quota'

const USER = '00000000-0000-4000-8000-00000000000a'
const INCREMENT = 'SELECT public.increment_usage($1, $2, $3)'
const INCREMENT_USAGE = 'public.increment_usage(uuid, text, integer)'
const HANDLE_NEW_USER = 'public.handle_new_user()'
const SIGN_UP = 'INSERT INTO auth.users (id) VALUES ($1)'

const secondsUsed = async (pg: PGlite, month: string) => {
  const res = await pg.query<{ seconds_used: number }>(
    'SELECT seconds_used FROM public.usage WHERE user_id = $1 AND month = $2',
    [USER, month]
  )
  return res.rows[0]?.seconds_used ?? null
}

const canCall = async (pg: PGlite, fn: string, roles = ['anon', 'authenticated', 'service_role']) => {
  const res = await pg.query<{ role: string; can_call: boolean }>(
    `SELECT r AS role, has_function_privilege(r, $1, 'EXECUTE') AS can_call FROM unnest($2::text[]) AS r`,
    [fn, roles]
  )
  return Object.fromEntries(res.rows.map(row => [row.role, row.can_call]))
}

/** Sorted ACL entries of a function or table, e.g. ['anon=X/postgres', ...]. */
const acl = async (pg: PGlite, catalog: 'pg_proc' | 'pg_class', oid: string) => {
  const cast = catalog === 'pg_proc' ? 'regprocedure' : 'regclass'
  const column = catalog === 'pg_proc' ? 'proacl' : 'relacl'
  const res = await pg.query<{ entry: string }>(
    `SELECT unnest(${column})::text AS entry FROM ${catalog} WHERE oid = $1::${cast} ORDER BY 1`,
    [oid]
  )
  return res.rows.map(row => row.entry)
}

const subscriptionOf = async (pg: PGlite, userId: string) => {
  const res = await pg.query<{ plan: string }>('SELECT plan FROM public.subscriptions WHERE user_id = $1', [userId])
  return res.rows.map(row => row.plan)
}

// The increment_usage part must hold both on a database built from this repo
// and on production, whose usage table is shaped differently.
describe.each([
  ['a database built from the repo (001)', () => createTestDb(['001_initial.sql', '005_ai_token_usage.sql'])],
  ['the production structure', () => createProductionLikeDb()],
])('migration 006 — increment_usage on %s', (_name, createDb) => {
  let pg: PGlite

  beforeAll(async () => {
    pg = await createDb()
    await pg.query(SIGN_UP, [USER])
  })
  afterAll(() => pg.close())

  it('before: reproduces the hole, anon and authenticated can inflate a user', async () => {
    expect(await canCall(pg, INCREMENT_USAGE)).toEqual({ anon: true, authenticated: true, service_role: true })
    await queryAs(pg, 'anon', INCREMENT, [USER, '2026-10', 1800])
    await queryAs(pg, 'authenticated', INCREMENT, [USER, '2026-10', 1800])
    expect(await secondsUsed(pg, '2026-10')).toBe(3600)
  })

  it('after: anon and authenticated are refused and nothing is counted', async () => {
    await pg.exec(readMigration('006_lock_increment_usage.sql'))

    expect(await canCall(pg, INCREMENT_USAGE)).toEqual({ anon: false, authenticated: false, service_role: true })
    for (const role of ['anon', 'authenticated']) {
      await expect(queryAs(pg, role, INCREMENT, [USER, '2026-11', 1800])).rejects.toThrow(
        /permission denied for function increment_usage/
      )
    }
    expect(await secondsUsed(pg, '2026-11')).toBeNull()
  })

  it('after: the server (service role) still records usage', async () => {
    await queryAs(pg, 'service_role', INCREMENT, [USER, '2026-11', 42])
    await queryAs(pg, 'service_role', INCREMENT, [USER, '2026-11', 8])
    expect(await secondsUsed(pg, '2026-11')).toBe(50)
  })

  it('touches nothing else: data, function body and other functions stay as they were', async () => {
    expect(await secondsUsed(pg, '2026-10')).toBe(3600)

    const fn = await pg.query<{ prosecdef: boolean; proconfig: string[]; prosrc: string }>(
      'SELECT prosecdef, proconfig, prosrc FROM pg_proc WHERE oid = $1::regprocedure',
      [INCREMENT_USAGE]
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
    await expect(queryAs(pg, 'anon', INCREMENT, [USER, '2026-12', 1])).rejects.toThrow(/permission denied/)
    await queryAs(pg, 'service_role', INCREMENT, [USER, '2026-12', 1])
    expect(await secondsUsed(pg, '2026-12')).toBe(1)
  })
})

describe('migration 006 — handle_new_user and signup on the production structure', () => {
  let pg: PGlite
  const newUser = (n: number) => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`

  beforeAll(async () => {
    pg = await createProductionLikeDb()
    // A role that may insert into auth.users but holds no EXECUTE on the trigger
    // function at all once PUBLIC is revoked.
    await pg.exec(`
      CREATE ROLE signup_without_execute NOLOGIN;
      GRANT USAGE ON SCHEMA auth TO signup_without_execute;
      GRANT INSERT ON auth.users TO signup_without_execute;
    `)
  })
  afterAll(() => pg.close())

  it('the fixture carries the privileges read from production on 2026-10-02', async () => {
    expect(await acl(pg, 'pg_proc', HANDLE_NEW_USER)).toEqual([
      '=X/postgres',
      'anon=X/postgres',
      'authenticated=X/postgres',
      'postgres=X/postgres',
      'service_role=X/postgres',
    ])
    expect(await acl(pg, 'pg_proc', INCREMENT_USAGE)).toEqual([
      'anon=X/postgres',
      'authenticated=X/postgres',
      'postgres=X/postgres',
      'service_role=X/postgres',
    ])
    expect(await acl(pg, 'pg_proc', 'public.increment_ai_tokens(uuid, text, bigint)')).toEqual([
      'postgres=X/postgres',
      'service_role=X/postgres',
    ])
    for (const table of ['public.subscriptions', 'public.usage']) {
      expect(await acl(pg, 'pg_class', table)).toEqual([
        'anon=arwdDxtm/postgres',
        'authenticated=arwdDxtm/postgres',
        'postgres=arwdDxtm/postgres',
        'service_role=arwdDxtm/postgres',
      ])
    }
    const owner = await pg.query<{ owner: string }>(
      "SELECT pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid = 'auth.users'::regclass"
    )
    expect(owner.rows[0].owner).toBe('supabase_auth_admin')
  })

  it('before: signup creates a free subscription; the function is executable by everyone', async () => {
    await queryAs(pg, 'supabase_auth_admin', SIGN_UP, [newUser(1)])
    expect(await subscriptionOf(pg, newUser(1))).toEqual(['free'])

    expect(
      await canCall(pg, HANDLE_NEW_USER, ['anon', 'authenticated', 'supabase_auth_admin', 'signup_without_execute'])
    ).toEqual({ anon: true, authenticated: true, supabase_auth_admin: true, signup_without_execute: true })
    // ...but a trigger function cannot be called directly, so it was not an open door.
    await expect(queryAs(pg, 'anon', 'SELECT public.handle_new_user()')).rejects.toThrow(
      /trigger functions can only be called as triggers/
    )
  })

  it('after: anon and authenticated can no longer execute handle_new_user', async () => {
    await pg.exec(readMigration('006_lock_increment_usage.sql'))

    expect(
      await canCall(pg, HANDLE_NEW_USER, ['anon', 'authenticated', 'supabase_auth_admin', 'signup_without_execute'])
    ).toEqual({ anon: false, authenticated: false, supabase_auth_admin: true, signup_without_execute: false })
    for (const role of ['anon', 'authenticated']) {
      await expect(queryAs(pg, role, 'SELECT public.handle_new_user()')).rejects.toThrow(
        /permission denied for function handle_new_user/
      )
    }
    expect(await acl(pg, 'pg_proc', HANDLE_NEW_USER)).toEqual([
      'postgres=X/postgres',
      'service_role=X/postgres',
      'supabase_auth_admin=X/postgres',
    ])
  })

  it('after: signup by supabase_auth_admin still creates the free subscription', async () => {
    await queryAs(pg, 'supabase_auth_admin', SIGN_UP, [newUser(2)])
    expect(await subscriptionOf(pg, newUser(2))).toEqual(['free'])
  })

  it('after: the trigger fires even for a role with no EXECUTE on the function', async () => {
    await queryAs(pg, 'signup_without_execute', SIGN_UP, [newUser(3)])
    expect(await subscriptionOf(pg, newUser(3))).toEqual(['free'])
  })

  it('after: trigger, function body, policies and existing rows are unchanged', async () => {
    const trigger = await pg.query<{ def: string; enabled: string }>(
      "SELECT pg_get_triggerdef(oid) AS def, tgenabled::text AS enabled FROM pg_trigger WHERE tgname = 'on_auth_user_created'"
    )
    expect(trigger.rows).toEqual([
      {
        def: 'CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user()',
        enabled: 'O',
      },
    ])
    const fn = await pg.query<{ prosecdef: boolean; prosrc: string }>(
      'SELECT prosecdef, prosrc FROM pg_proc WHERE oid = $1::regprocedure',
      [HANDLE_NEW_USER]
    )
    expect(fn.rows[0].prosecdef).toBe(true)
    expect(fn.rows[0].prosrc).toContain('insert into public.subscriptions (user_id) values (new.id)')

    const policies = await pg.query<{ policyname: string }>(
      "SELECT policyname FROM pg_policies WHERE schemaname = 'public' ORDER BY 1"
    )
    expect(policies.rows.map(row => row.policyname)).toEqual([
      'Users can view own subscription',
      'Users can view own usage',
    ])
    expect(await subscriptionOf(pg, newUser(1))).toEqual(['free'])
  })

  it('the quota code reads the plan from the production-shaped subscriptions table', async () => {
    const supabase = fakeSupabase(pg)
    expect(await getAiQuotaStatus(supabase, newUser(2))).toMatchObject({ plan: 'free', limitTokens: 300_000 })

    await pg.query("UPDATE public.subscriptions SET plan = 'pro' WHERE user_id = $1", [newUser(2)])
    expect(await getAiQuotaStatus(supabase, newUser(2))).toMatchObject({ plan: 'pro', limitTokens: 5_000_000 })
  })
})
