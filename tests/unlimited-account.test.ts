import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
import type { PGlite } from '@electric-sql/pglite'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  createProductionLikeDb,
  createTestDb,
  fakeSupabase,
  queryAs,
  readMigration,
  tokensUsed,
} from './helpers/test-db'

const OWNER = '00000000-0000-4000-8000-0000000000a1'
const OWNER_EMAIL = 'owner@example.com'
const FREE_USER = '00000000-0000-4000-8000-0000000000f1'
const PRO_USER = '00000000-0000-4000-8000-0000000000b2'
const TOKENS: Record<string, string> = { 'owner-token': OWNER, 'free-token': FREE_USER, 'pro-token': PRO_USER }

const state = vi.hoisted(() => ({ supabase: null as unknown }))

vi.mock('@/lib/supabase-server', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/supabase-server')>()),
  createAdminClient: () => state.supabase as SupabaseClient,
  validateToken: async (token: string) => TOKENS[token] ?? null,
}))

import { POST as chat } from '@/app/api/chat/completions/route'
import { POST as transcribe } from '@/app/api/transcribe/route'
import { GET as getUsage } from '@/app/api/usage/route'
import { getAccount } from '@/lib/account'

const MARK_SCRIPT = readFileSync(
  join(__dirname, '..', 'supabase', 'scripts', 'mark-unlimited-account.sql'),
  'utf8'
)
const markUnlimited = (pg: PGlite, email: string) =>
  pg.query<{ user_id: string; plan: string; unlimited: boolean }>(
    MARK_SCRIPT.replace(/OWNER_EMAIL/g, email.replace(/'/g, "''"))
  )

const MIGRATIONS_TO_007 = [
  '002_sync.sql',
  '003_mcp_tokens.sql',
  '004_mcp_token_expiry.sql',
  '005_ai_token_usage.sql',
  '006_lock_increment_usage.sql',
  '007_unlimited_accounts.sql',
]

const subscription = async (pg: PGlite, userId: string) => {
  const res = await pg.query<{ plan: string; unlimited: boolean; polar_customer_id: string | null }>(
    'SELECT plan, unlimited, polar_customer_id FROM public.subscriptions WHERE user_id = $1',
    [userId]
  )
  return res.rows[0] ?? null
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` })

const chatRequest = (token: string) =>
  new NextRequest('http://localhost/api/chat/completions', {
    method: 'POST',
    headers: { ...bearer(token), 'content-type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'Clean up this text.' }] }),
  })

const transcribeRequest = (token: string) =>
  new NextRequest('http://localhost/api/transcribe', {
    method: 'POST',
    // Multipart, as Groq takes it; a 3-byte file the server cannot measure, so the
    // app's 60-second header is what gets counted.
    headers: { ...bearer(token), 'x-audio-duration-seconds': '60' },
    body: (() => {
      const form = new FormData()
      form.append('file', new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' }), 'audio.webm')
      return form
    })(),
  })

const usageRequest = (token: string) => new NextRequest('http://localhost/api/usage', { headers: bearer(token) })

const groqChatOk = (totalTokens: number) =>
  new Response(
    JSON.stringify({
      choices: [{ message: { role: 'assistant', content: 'Cleaned text.' } }],
      usage: { total_tokens: totalTokens },
    }),
    { status: 200 }
  )

describe('migration 007 on the production structure', () => {
  let pg: PGlite

  beforeAll(async () => {
    pg = await createProductionLikeDb(MIGRATIONS_TO_007.slice(0, 5))
    // Accounts that exist before the migration, created through the signup trigger.
    await queryAs(pg, 'supabase_auth_admin', 'INSERT INTO auth.users (id, email) VALUES ($1, $2), ($3, $4)', [
      OWNER,
      'Owner@Example.com',
      PRO_USER,
      'pro@example.com',
    ])
    await pg.query(
      "UPDATE public.subscriptions SET plan = 'pro', polar_customer_id = 'cus_1' WHERE user_id = $1",
      [PRO_USER]
    )
    await pg.exec(readMigration('007_unlimited_accounts.sql'))
  })
  afterAll(() => pg.close())

  it('gives every existing row unlimited = false and keeps plans', async () => {
    expect(await subscription(pg, OWNER)).toEqual({ plan: 'free', unlimited: false, polar_customer_id: null })
    expect(await subscription(pg, PRO_USER)).toEqual({ plan: 'pro', unlimited: false, polar_customer_id: 'cus_1' })
  })

  it('signup still works and new accounts are not unlimited', async () => {
    await queryAs(pg, 'supabase_auth_admin', 'INSERT INTO auth.users (id, email) VALUES ($1, $2)', [
      FREE_USER,
      'free@example.com',
    ])
    expect(await subscription(pg, FREE_USER)).toEqual({ plan: 'free', unlimited: false, polar_customer_id: null })
  })

  it('the marking script marks only the account with that email (any letter case)', async () => {
    const res = await markUnlimited(pg, OWNER_EMAIL)
    expect(res.rows).toEqual([{ user_id: OWNER, plan: 'free', unlimited: true }])
    expect((await subscription(pg, PRO_USER))?.unlimited).toBe(false)
    expect((await subscription(pg, FREE_USER))?.unlimited).toBe(false)
  })

  it('the marking script keeps the plan and Polar fields of an existing row', async () => {
    const res = await markUnlimited(pg, 'pro@example.com')
    expect(res.rows).toEqual([{ user_id: PRO_USER, plan: 'pro', unlimited: true }])
    expect(await subscription(pg, PRO_USER)).toEqual({ plan: 'pro', unlimited: true, polar_customer_id: 'cus_1' })
    await pg.query('UPDATE public.subscriptions SET unlimited = false WHERE user_id = $1', [PRO_USER])
  })

  it('the marking script creates the row when the account has none', async () => {
    await pg.query('DELETE FROM public.subscriptions WHERE user_id = $1', [OWNER])
    const res = await markUnlimited(pg, OWNER_EMAIL)
    expect(res.rows).toEqual([{ user_id: OWNER, plan: 'free', unlimited: true }])
  })

  it('the marking script changes nothing for an unknown email', async () => {
    const res = await markUnlimited(pg, 'nobody@example.com')
    expect(res.rows).toEqual([])
  })

  it('a Polar webhook upsert (named columns) does not reset the flag', async () => {
    await pg.query(
      `INSERT INTO public.subscriptions (user_id, plan, polar_subscription_id, polar_customer_id, current_period_end, updated_at)
       VALUES ($1, 'pro', 'sub_9', 'cus_9', now(), now())
       ON CONFLICT (user_id) DO UPDATE SET plan = EXCLUDED.plan, polar_subscription_id = EXCLUDED.polar_subscription_id,
         polar_customer_id = EXCLUDED.polar_customer_id, current_period_end = EXCLUDED.current_period_end,
         updated_at = EXCLUDED.updated_at`,
      [OWNER]
    )
    expect(await subscription(pg, OWNER)).toEqual({ plan: 'pro', unlimited: true, polar_customer_id: 'cus_9' })
    await pg.query("UPDATE public.subscriptions SET plan = 'free' WHERE user_id = $1", [OWNER])
    expect((await subscription(pg, OWNER))?.unlimited).toBe(true)
  })

  it('a signed-in user can read but not set their own flag', async () => {
    await pg.exec(`SET request.jwt.claim.sub = '${FREE_USER}'`)
    try {
      const seen = await queryAs<{ unlimited: boolean }>(
        pg,
        'authenticated',
        'SELECT unlimited FROM public.subscriptions WHERE user_id = $1',
        [FREE_USER]
      )
      expect(seen.rows).toEqual([{ unlimited: false }])
      const changed = await queryAs(
        pg,
        'authenticated',
        'UPDATE public.subscriptions SET unlimited = true WHERE user_id = $1',
        [FREE_USER]
      )
      expect(changed.affectedRows ?? 0).toBe(0)
    } finally {
      await pg.exec('RESET request.jwt.claim.sub')
    }
    expect((await subscription(pg, FREE_USER))?.unlimited).toBe(false)
  })

  it('can be applied twice without changing flags', async () => {
    await pg.exec(readMigration('007_unlimited_accounts.sql'))
    expect((await subscription(pg, OWNER))?.unlimited).toBe(true)
  })

  it('also applies to a database built from the repo (001)', async () => {
    const repoDb = await createTestDb(['001_initial.sql', '005_ai_token_usage.sql', '006_lock_increment_usage.sql'])
    try {
      await repoDb.exec(readMigration('007_unlimited_accounts.sql'))
      await repoDb.query('INSERT INTO auth.users (id, email) VALUES ($1, $2)', [OWNER, OWNER_EMAIL])
      const res = await markUnlimited(repoDb, OWNER_EMAIL)
      expect(res.rows).toEqual([{ user_id: OWNER, plan: 'free', unlimited: true }])
    } finally {
      await repoDb.close()
    }
  })
})

describe('the server with an account marked unlimited', () => {
  let pg: PGlite
  const fetchMock = vi.fn()

  const setTokens = (userId: string, tokens: number) =>
    pg.query(
      `INSERT INTO public.ai_token_usage (user_id, month, tokens_used) VALUES ($1, '2026-10', $2)
       ON CONFLICT (user_id, month) DO UPDATE SET tokens_used = EXCLUDED.tokens_used`,
      [userId, tokens]
    )
  const setSeconds = (userId: string, seconds: number) =>
    pg.query(
      `INSERT INTO public.usage (user_id, month, seconds_used) VALUES ($1, '2026-10', $2)
       ON CONFLICT (user_id, month) DO UPDATE SET seconds_used = EXCLUDED.seconds_used`,
      [userId, seconds]
    )

  beforeAll(async () => {
    pg = await createProductionLikeDb(MIGRATIONS_TO_007)
    await queryAs(pg, 'supabase_auth_admin', 'INSERT INTO auth.users (id, email) VALUES ($1, $2), ($3, $4), ($5, $6)', [
      OWNER,
      OWNER_EMAIL,
      FREE_USER,
      'free@example.com',
      PRO_USER,
      'pro@example.com',
    ])
    await pg.query("UPDATE public.subscriptions SET plan = 'pro' WHERE user_id = $1", [PRO_USER])
    await markUnlimited(pg, OWNER_EMAIL)
    state.supabase = fakeSupabase(pg)
  })
  afterAll(() => pg.close())

  beforeEach(async () => {
    await pg.exec('DELETE FROM public.ai_token_usage; DELETE FROM public.usage;')
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-15T08:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('AI text: far past the Pro limit, the unlimited account still gets through and is counted', async () => {
    await setTokens(OWNER, 9_000_000)
    fetchMock.mockResolvedValueOnce(groqChatOk(1_000))

    const res = await chat(chatRequest('owner-token'))

    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(await tokensUsed(pg, OWNER, '2026-10')).toBe(9_001_000)
  })

  it('AI text: other accounts are still refused at their limits', async () => {
    await setTokens(FREE_USER, 300_000)
    await setTokens(PRO_USER, 5_000_000)

    expect((await chat(chatRequest('free-token'))).status).toBe(402)
    expect((await chat(chatRequest('pro-token'))).status).toBe(402)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('minutes: past the Free 30 minutes, the unlimited account still transcribes and is counted', async () => {
    await setSeconds(OWNER, 5_000)
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ text: 'hello' }), { status: 200 }))

    const res = await transcribe(transcribeRequest('owner-token'))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ text: 'hello' })
    const row = await pg.query<{ seconds_used: number }>(
      "SELECT seconds_used FROM public.usage WHERE user_id = $1 AND month = '2026-10'",
      [OWNER]
    )
    expect(row.rows[0].seconds_used).toBe(5_060)
  })

  it('minutes: an ordinary Free account is still refused after 30 minutes', async () => {
    await setSeconds(FREE_USER, 1_800)

    const res = await transcribe(transcribeRequest('free-token'))

    expect(res.status).toBe(402)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('/api/usage tells the app the account has no limits', async () => {
    await setTokens(OWNER, 1_234)

    expect(await (await getUsage(usageRequest('owner-token'))).json()).toMatchObject({
      plan: 'free',
      unlimited: true,
      limitSeconds: null,
      aiTokensUsed: 1_234,
      aiTokensLimit: null,
    })
    expect(await (await getUsage(usageRequest('free-token'))).json()).toMatchObject({
      plan: 'free',
      unlimited: false,
      limitSeconds: 1800,
      aiTokensLimit: 300_000,
    })
  })
})

describe('before migration 007 is applied (no unlimited column)', () => {
  let pg: PGlite

  beforeAll(async () => {
    pg = await createProductionLikeDb(MIGRATIONS_TO_007.slice(0, 5))
    await queryAs(pg, 'supabase_auth_admin', 'INSERT INTO auth.users (id, email) VALUES ($1, $2)', [
      PRO_USER,
      'pro@example.com',
    ])
    await pg.query("UPDATE public.subscriptions SET plan = 'pro' WHERE user_id = $1", [PRO_USER])
  })
  afterAll(() => pg.close())

  it('plans are read as before and nobody is unlimited', async () => {
    expect(await getAccount(fakeSupabase(pg), PRO_USER)).toEqual({
      plan: 'pro',
      unlimited: false,
      currentPeriodEnd: null,
    })
    expect(await getAccount(fakeSupabase(pg), FREE_USER)).toEqual({
      plan: 'free',
      unlimited: false,
      currentPeriodEnd: null,
    })
  })
})
