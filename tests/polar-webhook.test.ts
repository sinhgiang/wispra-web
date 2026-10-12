import { createHmac } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { PGlite } from '@electric-sql/pglite'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createProductionLikeDb, fakeSupabase, queryAs } from './helpers/test-db'
import { verifyPolarWebhook } from '@/lib/polar-webhook'

const state = vi.hoisted(() => ({ supabase: null as unknown }))

vi.mock('@/lib/supabase-server', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/supabase-server')>()),
  createAdminClient: () => state.supabase as SupabaseClient,
}))

import { POST } from '@/app/api/webhook/polar/route'

const SECRET = 'polar_whs_test_not_a_real_secret'
const ALICE = '00000000-0000-4000-8000-0000000000a1'
const BOB = '00000000-0000-4000-8000-0000000000b2'
const NOW = 1791500000 // 2026-10-09, Unix seconds
const MANY = 120
const userId = (n: number) => `00000000-0000-4000-8000-${String(100000 + n).padStart(12, '0')}`
const userEmail = (n: number) => `user-${String(n).padStart(3, '0')}@example.com`

/** Independent signer, written from the Standard Webhooks spec. */
const sign = (id: string, ts: number, body: string, secret = SECRET) =>
  `v1,${createHmac('sha256', Buffer.from(secret, 'utf8')).update(`${id}.${ts}.${body}`).digest('base64')}`

const headersFor = (id: string, ts: number, signature: string) =>
  new Headers({ 'webhook-id': id, 'webhook-timestamp': String(ts), 'webhook-signature': signature })

describe('verifyPolarWebhook (Standard Webhooks, as Polar signs)', () => {
  const body = '{"type":"subscription.created","data":{"id":"sub_1"}}'

  it('accepts the signature the official standardwebhooks library makes with Polar’s key transform', () => {
    // Made once with standardwebhooks 1.0.0:
    //   new Webhook(Buffer.from(SECRET, 'utf-8').toString('base64')).sign('msg_test_1', new Date(NOW * 1000), body)
    // which is exactly what @polar-sh/sdk's validateEvent does with the secret.
    const fromLibrary = 'v1,0qvrKki7uYGrfNvj+Y44/+byM4WU4YOROvUPUxjz4oU='
    expect(sign('msg_test_1', NOW, body)).toBe(fromLibrary)
    expect(verifyPolarWebhook(headersFor('msg_test_1', NOW, fromLibrary), body, SECRET, NOW)).toEqual({
      ok: true,
      id: 'msg_test_1',
    })
  })

  it('refuses a signature made with another secret', () => {
    const sig = sign('msg_1', NOW, body, 'polar_whs_someone_else')
    expect(verifyPolarWebhook(headersFor('msg_1', NOW, sig), body, SECRET, NOW)).toEqual({ ok: false, reason: 'bad-signature' })
  })

  it('refuses a changed body, id or timestamp under a valid signature', () => {
    const sig = sign('msg_1', NOW, body)
    const changedBody = body.replace('sub_1', 'sub_2')
    expect(verifyPolarWebhook(headersFor('msg_1', NOW, sig), changedBody, SECRET, NOW).ok).toBe(false)
    expect(verifyPolarWebhook(headersFor('msg_2', NOW, sig), body, SECRET, NOW).ok).toBe(false)
    expect(verifyPolarWebhook(headersFor('msg_1', NOW - 1, sig), body, SECRET, NOW).ok).toBe(false)
  })

  it('refuses the old check: a hex HMAC of the body alone', () => {
    const hex = createHmac('sha256', SECRET).update(body).digest('hex')
    const headers = new Headers({ 'x-polar-signature': hex, 'webhook-signature': hex, 'webhook-id': 'msg_1', 'webhook-timestamp': String(NOW) })
    expect(verifyPolarWebhook(headers, body, SECRET, NOW)).toEqual({ ok: false, reason: 'bad-signature' })
  })

  it('refuses deliveries signed more than 5 minutes before or after now', () => {
    for (const ts of [NOW - 301, NOW + 301]) {
      expect(verifyPolarWebhook(headersFor('msg_1', ts, sign('msg_1', ts, body)), body, SECRET, NOW)).toEqual({
        ok: false,
        reason: 'stale',
      })
    }
    for (const ts of [NOW - 300, NOW + 300]) {
      expect(verifyPolarWebhook(headersFor('msg_1', ts, sign('msg_1', ts, body)), body, SECRET, NOW).ok).toBe(true)
    }
  })

  it('refuses missing headers, a non-numeric timestamp and a missing secret', () => {
    const sig = sign('msg_1', NOW, body)
    expect(verifyPolarWebhook(new Headers({ 'webhook-signature': sig }), body, SECRET, NOW)).toEqual({
      ok: false,
      reason: 'missing-headers',
    })
    const badTs = new Headers({ 'webhook-id': 'msg_1', 'webhook-timestamp': '2026-10-09', 'webhook-signature': sig })
    expect(verifyPolarWebhook(badTs, body, SECRET, NOW)).toEqual({ ok: false, reason: 'bad-timestamp' })
    expect(verifyPolarWebhook(headersFor('msg_1', NOW, sig), body, undefined, NOW)).toEqual({ ok: false, reason: 'no-secret' })
    expect(verifyPolarWebhook(headersFor('msg_1', NOW, sig), body, '', NOW)).toEqual({ ok: false, reason: 'no-secret' })
  })

  it('accepts when one of several signatures matches (secret rotation) and skips other versions', () => {
    const good = sign('msg_1', NOW, body)
    const other = sign('msg_1', NOW, body, 'polar_whs_old')
    const value = `v1a,${good.slice(3)} ${other} ${good}`
    expect(verifyPolarWebhook(headersFor('msg_1', NOW, value), body, SECRET, NOW).ok).toBe(true)
    expect(verifyPolarWebhook(headersFor('msg_1', NOW, `v1a,${good.slice(3)}`), body, SECRET, NOW).ok).toBe(false)
  })
})

describe('POST /api/webhook/polar', () => {
  let pg: PGlite
  let listUsers: ReturnType<typeof vi.fn>
  let getUserById: ReturnType<typeof vi.fn>

  /** Like Supabase's auth admin API: listUsers() returns 50 accounts unless asked for another page or size. */
  const listPage = async ({ page = 1, perPage = 50 }: { page?: number; perPage?: number } = {}) => {
    const res = await pg.query<{ id: string; email: string }>('SELECT id, email FROM auth.users ORDER BY email LIMIT $1 OFFSET $2', [
      perPage + 1,
      (page - 1) * perPage,
    ])
    const more = res.rows.length > perPage
    return { data: { users: res.rows.slice(0, perPage), aud: 'authenticated', nextPage: more ? page + 1 : null }, error: null }
  }
  const withAuth = (client: SupabaseClient) => {
    listUsers = vi.fn(listPage)
    getUserById = vi.fn(async (id: string) => {
      const res = await pg.query<{ id: string; email: string }>('SELECT id, email FROM auth.users WHERE id = $1', [id])
      return res.rows[0]
        ? { data: { user: res.rows[0] }, error: null }
        : { data: { user: null }, error: { message: 'User not found', status: 404 } }
    })
    return Object.assign(client, { auth: { admin: { listUsers, getUserById } } }) as SupabaseClient
  }

  const deliver = (id: string, event: unknown, opts: { ts?: number; secret?: string; signature?: string } = {}) => {
    const body = JSON.stringify(event)
    const ts = opts.ts ?? NOW
    return POST(
      new NextRequest('http://localhost/api/webhook/polar', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'webhook-id': id,
          'webhook-timestamp': String(ts),
          'webhook-signature': opts.signature ?? sign(id, ts, body, opts.secret),
        },
        body,
      })
    )
  }

  /** A subscription event shaped as Polar sends it: the buyer is in data.customer. */
  const subscription = (
    type: string,
    status = 'active',
    email = 'alice@example.com',
    extra: { id?: string; customerId?: string; externalId?: string | null; cancelAtPeriodEnd?: boolean } = {}
  ) => ({
    type,
    data: {
      id: extra.id ?? 'sub_alice',
      customer_id: extra.customerId ?? 'cus_alice',
      status,
      current_period_end: '2026-11-09T00:00:00Z',
      cancel_at_period_end: extra.cancelAtPeriodEnd ?? false,
      customer: { id: extra.customerId ?? 'cus_alice', email, external_id: extra.externalId ?? null },
    },
  })

  const planOf = async (userId: string) =>
    (await pg.query<{ plan: string }>('SELECT plan FROM public.subscriptions WHERE user_id = $1', [userId])).rows[0]?.plan
  const recorded = async () => (await pg.query<{ webhook_id: string }>('SELECT webhook_id FROM public.webhook_events ORDER BY webhook_id')).rows.map(r => r.webhook_id)

  beforeAll(async () => {
    pg = await createProductionLikeDb(['002_sync.sql', '011_webhook_events.sql'])
    await queryAs(pg, 'supabase_auth_admin', 'INSERT INTO auth.users (id, email) VALUES ($1, $2), ($3, $4)', [
      ALICE,
      'alice@example.com',
      BOB,
      'bob@example.com',
    ])
    // 120 more accounts, so a buyer can sit past the first 50 that listUsers() returns.
    for (let n = 0; n < MANY; n++) {
      await queryAs(pg, 'supabase_auth_admin', 'INSERT INTO auth.users (id, email) VALUES ($1, $2)', [userId(n), userEmail(n)])
    }
  })
  afterAll(() => pg.close())

  beforeEach(async () => {
    process.env.POLAR_WEBHOOK_SECRET = SECRET
    state.supabase = withAuth(fakeSupabase(pg))
    await pg.exec(`
      DELETE FROM public.webhook_events;
      UPDATE public.subscriptions SET plan = 'free', polar_subscription_id = NULL, polar_customer_id = NULL, current_period_end = NULL;
    `)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(NOW * 1000))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    delete process.env.POLAR_WEBHOOK_SECRET
  })

  it('applies a correctly signed subscription.created: the buyer gets Pro, nobody else', async () => {
    const res = await deliver('msg_created', subscription('subscription.created'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(await planOf(ALICE)).toBe('pro')
    expect(await planOf(BOB)).toBe('free')
    expect(await recorded()).toEqual(['msg_created'])
  })

  it('refuses a wrong signature with 401 and changes nothing', async () => {
    const res = await deliver('msg_forged', subscription('subscription.created'), { secret: 'polar_whs_attacker' })
    expect(res.status).toBe(401)
    expect(await planOf(ALICE)).toBe('free')
    expect(await recorded()).toEqual([])
    expect(listUsers).not.toHaveBeenCalled()
  })

  it('refuses a delivery signed more than 5 minutes ago, and one with no secret configured', async () => {
    const old = await deliver('msg_old', subscription('subscription.created'), { ts: NOW - 600 })
    expect(old.status).toBe(401)
    delete process.env.POLAR_WEBHOOK_SECRET
    const noSecret = await deliver('msg_nosecret', subscription('subscription.created'))
    expect(noSecret.status).toBe(401)
    expect(await planOf(ALICE)).toBe('free')
  })

  it('the same delivery sent twice is applied once', async () => {
    const first = await deliver('msg_twice', subscription('subscription.created'))
    expect(first.status).toBe(200)
    const second = await deliver('msg_twice', subscription('subscription.created'))
    expect(second.status).toBe(200)
    expect(await second.json()).toEqual({ ok: true, duplicate: true })
    expect(listUsers).toHaveBeenCalledTimes(1)
    expect(await recorded()).toEqual(['msg_twice'])
  })

  it('resending an old “created” after a cancel does not bring Pro back', async () => {
    const created = subscription('subscription.created')
    await deliver('msg_a', created)
    expect(await planOf(ALICE)).toBe('pro')
    await deliver('msg_b', subscription('subscription.canceled', 'canceled'))
    expect(await planOf(ALICE)).toBe('free')

    // Within the 5-minute window: stopped by the recorded webhook-id.
    vi.setSystemTime(new Date((NOW + 60) * 1000))
    expect((await deliver('msg_a', created)).status).toBe(200)
    expect(await planOf(ALICE)).toBe('free')

    // Later: stopped by the timestamp, even with the record gone.
    await pg.exec('DELETE FROM public.webhook_events')
    vi.setSystemTime(new Date((NOW + 3600) * 1000))
    expect((await deliver('msg_a', created)).status).toBe(401)
    expect(await planOf(ALICE)).toBe('free')
  })

  it('when applying fails, answers 500 and forgets the delivery so Polar’s retry is applied', async () => {
    listUsers.mockResolvedValueOnce({ data: { users: [] }, error: { message: 'auth down' } })
    const failed = await deliver('msg_retry', subscription('subscription.created'))
    expect(failed.status).toBe(500)
    expect(await failed.json()).toEqual({ error: 'Could not apply the webhook' })
    expect(await recorded()).toEqual([])
    expect(await planOf(ALICE)).toBe('free')

    const retry = await deliver('msg_retry', subscription('subscription.created'))
    expect(retry.status).toBe(200)
    expect(await planOf(ALICE)).toBe('pro')
    expect(await recorded()).toEqual(['msg_retry'])
  })

  it('records unhandled event types once and changes nothing', async () => {
    const res = await deliver('msg_order', { type: 'order.created', data: { id: 'ord_1' } })
    expect(res.status).toBe(200)
    expect(await recorded()).toEqual(['msg_order'])
    expect(await planOf(ALICE)).toBe('free')
  })

  it('a correctly signed body that is not JSON answers 400', async () => {
    const body = 'not json'
    const res = await POST(
      new NextRequest('http://localhost/api/webhook/polar', {
        method: 'POST',
        headers: { 'webhook-id': 'msg_bad', 'webhook-timestamp': String(NOW), 'webhook-signature': sign('msg_bad', NOW, body) },
        body,
      })
    )
    expect(res.status).toBe(400)
    expect(await recorded()).toEqual([])
  })

  it('before migration 011 is applied, events are still applied', async () => {
    const plain = await createProductionLikeDb(['002_sync.sql'])
    try {
      await queryAs(plain, 'supabase_auth_admin', 'INSERT INTO auth.users (id, email) VALUES ($1, $2)', [ALICE, 'alice@example.com'])
      const client = fakeSupabase(plain)
      Object.assign(client, {
        auth: { admin: { listUsers: async () => ({ data: { users: [{ id: ALICE, email: 'alice@example.com' }] }, error: null }) } },
      })
      state.supabase = client
      const res = await deliver('msg_pre011', subscription('subscription.created'))
      expect(res.status).toBe(200)
      const plan = (await plain.query<{ plan: string }>('SELECT plan FROM public.subscriptions WHERE user_id = $1', [ALICE])).rows[0]?.plan
      expect(plan).toBe('pro')
    } finally {
      await plain.close()
    }
  })

  it('webhook_events is closed to signed-in users and visitors (RLS, no policy)', async () => {
    await deliver('msg_rls', subscription('subscription.created'))
    for (const role of ['anon', 'authenticated']) {
      await expect(queryAs(pg, role, 'SELECT webhook_id FROM public.webhook_events')).rejects.toThrow()
      await expect(
        queryAs(pg, role, "INSERT INTO public.webhook_events (webhook_id) VALUES ('msg_fake')")
      ).rejects.toThrow()
    }
    expect(await recorded()).toEqual(['msg_rls'])
  })

  describe('finding the buyer', () => {
    it('a buyer past the first 50 accounts still gets Pro', async () => {
      const n = 100 // sorted by email, after alice, bob and user-000..user-099
      const res = await deliver('msg_far', subscription('subscription.created', 'active', userEmail(n), { id: 'sub_far', customerId: 'cus_far' }))
      expect(res.status).toBe(200)
      expect(await planOf(userId(n))).toBe('pro')
      expect(await planOf(ALICE)).toBe('free')
      expect((await listUsers.mock.results[0].value).data.users).toHaveLength(MANY + 2)
    })

    it('the last of many accounts is found when Supabase gives fewer accounts per page than asked', async () => {
      listUsers.mockImplementation(({ page = 1 }: { page?: number } = {}) => listPage({ page, perPage: 50 }))
      const last = MANY - 1
      const res = await deliver('msg_last', subscription('subscription.created', 'active', userEmail(last), { id: 'sub_last', customerId: 'cus_last' }))
      expect(res.status).toBe(200)
      expect(await planOf(userId(last))).toBe('pro')
      expect(listUsers).toHaveBeenCalledTimes(3)
    })

    it('matches the email whatever its case', async () => {
      await deliver('msg_case', subscription('subscription.created', 'active', ' Alice@Example.COM '))
      expect(await planOf(ALICE)).toBe('pro')
    })

    it('an email with no account changes nothing, after reading every page once', async () => {
      const res = await deliver('msg_nobody', subscription('subscription.created', 'active', 'nobody@example.com', { id: 'sub_x', customerId: 'cus_x' }))
      expect(res.status).toBe(200)
      expect(await pg.query("SELECT 1 FROM public.subscriptions WHERE plan = 'pro'")).toMatchObject({ rows: [] })
      expect(listUsers).toHaveBeenCalledTimes(1)
    })

    it('uses Polar’s external_id (the Wispra user id) before the email', async () => {
      const event = subscription('subscription.created', 'active', 'paid-with-another-email@example.com', { externalId: BOB, id: 'sub_bob', customerId: 'cus_bob' })
      expect((await deliver('msg_ext', event)).status).toBe(200)
      expect(await planOf(BOB)).toBe('pro')
      expect(getUserById).toHaveBeenCalledWith(BOB)
      expect(listUsers).not.toHaveBeenCalled()
    })

    it('an external_id with no account falls back to the email', async () => {
      const event = subscription('subscription.created', 'active', 'alice@example.com', { externalId: '00000000-0000-4000-8000-00000000dead' })
      expect((await deliver('msg_ext_unknown', event)).status).toBe(200)
      expect(await planOf(ALICE)).toBe('pro')
    })

    it('later events find the account by the stored subscription id, even after the email changed in Polar', async () => {
      await deliver('msg_first', subscription('subscription.created'))
      listUsers.mockClear()
      await deliver('msg_renew', subscription('subscription.updated', 'past_due', 'alice-new@example.com'))
      expect(await planOf(ALICE)).toBe('free')
      expect(listUsers).not.toHaveBeenCalled()
    })

    it('a new subscription of a known Polar customer finds the account by the stored customer id', async () => {
      await deliver('msg_old_sub', subscription('subscription.created', 'canceled'))
      listUsers.mockClear()
      await deliver('msg_new_sub', subscription('subscription.created', 'active', 'alice-new@example.com', { id: 'sub_alice_2' }))
      expect(await planOf(ALICE)).toBe('pro')
      expect(listUsers).not.toHaveBeenCalled()
    })

    it('an auth error while looking up answers 500 so Polar retries', async () => {
      getUserById.mockResolvedValueOnce({ data: { user: null }, error: { message: 'auth down', status: 503 } })
      const res = await deliver('msg_auth_down', subscription('subscription.created', 'active', 'alice@example.com', { externalId: ALICE }))
      expect(res.status).toBe(500)
      expect(await recorded()).toEqual([])
      expect(await planOf(ALICE)).toBe('free')
    })
  })

  describe('cancel and revoke', () => {
    const periodEndOf = async (id: string) =>
      (await pg.query<{ current_period_end: Date | null }>('SELECT current_period_end FROM public.subscriptions WHERE user_id = $1', [id])).rows[0]
        ?.current_period_end

    it('subscription.canceled at the end of the period keeps Pro until then; subscription.revoked ends it at once', async () => {
      await deliver('msg_buy', subscription('subscription.created'))
      expect(await planOf(ALICE)).toBe('pro')

      // Polar: canceled with cancel_at_period_end, status stays active until current_period_end.
      const canceled = await deliver('msg_cancel', subscription('subscription.canceled', 'active', 'alice@example.com', { cancelAtPeriodEnd: true }))
      expect(canceled.status).toBe(200)
      expect(await planOf(ALICE)).toBe('pro')
      expect((await periodEndOf(ALICE))?.toISOString()).toBe('2026-11-09T00:00:00.000Z')

      // At the end of the period Polar revokes it (status canceled).
      const revoked = await deliver('msg_revoke', subscription('subscription.revoked', 'canceled'))
      expect(revoked.status).toBe(200)
      expect(await planOf(ALICE)).toBe('free')
    })

    it('subscription.revoked downgrades at once, whatever status it carries', async () => {
      await deliver('msg_buy2', subscription('subscription.created'))
      await deliver('msg_unpaid', subscription('subscription.revoked', 'unpaid'))
      expect(await planOf(ALICE)).toBe('free')
      await deliver('msg_buy3', subscription('subscription.updated'))
      await deliver('msg_revoke_active', subscription('subscription.revoked', 'active'))
      expect(await planOf(ALICE)).toBe('free')
    })

    it('a cancel that ends access at once (status canceled) downgrades at once', async () => {
      await deliver('msg_buy4', subscription('subscription.created'))
      await deliver('msg_cancel_now', subscription('subscription.canceled', 'canceled'))
      expect(await planOf(ALICE)).toBe('free')
    })

    it('ending another subscription of the same customer does not take away the one still paid', async () => {
      await deliver('msg_paid', subscription('subscription.created', 'active', 'alice@example.com', { id: 'sub_alice_2' }))
      expect(await planOf(ALICE)).toBe('pro')
      await deliver('msg_other_revoked', subscription('subscription.revoked', 'canceled', 'alice@example.com', { id: 'sub_alice_old' }))
      await deliver('msg_other_canceled', subscription('subscription.canceled', 'canceled', 'alice@example.com', { id: 'sub_alice_old' }))
      expect(await planOf(ALICE)).toBe('pro')
    })

    it('a revoked subscription with no account changes nothing', async () => {
      const res = await deliver('msg_revoke_nobody', subscription('subscription.revoked', 'canceled', 'nobody@example.com', { id: 'sub_x', customerId: 'cus_x' }))
      expect(res.status).toBe(200)
      expect(await planOf(ALICE)).toBe('free')
    })
  })
})
