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

  const withAuth = (client: SupabaseClient) => {
    listUsers = vi.fn(async () => {
      const res = await pg.query<{ id: string; email: string }>('SELECT id, email FROM auth.users')
      return { data: { users: res.rows }, error: null }
    })
    return Object.assign(client, { auth: { admin: { listUsers } } }) as SupabaseClient
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

  const subscription = (type: string, status = 'active', email = 'alice@example.com') => ({
    type,
    data: { id: 'sub_alice', customer_id: 'cus_alice', customer_email: email, status, current_period_end: '2026-11-09T00:00:00Z' },
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
  })
  afterAll(() => pg.close())

  beforeEach(async () => {
    process.env.POLAR_WEBHOOK_SECRET = SECRET
    state.supabase = withAuth(fakeSupabase(pg))
    await pg.exec(`DELETE FROM public.webhook_events; UPDATE public.subscriptions SET plan = 'free';`)
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
})
