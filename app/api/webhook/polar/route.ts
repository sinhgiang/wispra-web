import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase-server'
import { serverError } from '@/lib/api-errors'
import { isMissingTable } from '@/lib/history-deletions'
import { verifyPolarWebhook } from '@/lib/polar-webhook'

interface PolarEvent {
  type: string
  data: {
    id: string
    customer_id: string
    status: string
    current_period_end?: string | null
    /** The buyer. Polar sends it on every subscription event. */
    customer?: { email?: string | null; external_id?: string | null }
    /** Not in Polar's subscription schema; read only when `customer.email` is missing. */
    customer_email?: string
  }
}

type Claim = 'claimed' | 'duplicate' | 'unrecorded'

/**
 * Records the delivery's webhook-id before the event is applied. Polar resends
 * the same id on every retry, so a second delivery finds the row and is skipped.
 * Before migration 011 is applied the table is missing and events are applied
 * without the record (the 5-minute timestamp window still refuses old replays).
 */
async function claimDelivery(supabase: SupabaseClient, webhookId: string, type: string): Promise<Claim | { error: unknown }> {
  const { error } = await supabase.from('webhook_events').insert({ webhook_id: webhookId, source: 'polar', event_type: type })
  if (!error) return 'claimed'
  if (error.code === '23505') return 'duplicate'
  if (isMissingTable(error)) {
    console.warn('[webhook/polar] webhook_events table missing (migration 011): applying without the duplicate check')
    return 'unrecorded'
  }
  return { error }
}

type Found = { id: string | null } | { error: unknown }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const USERS_PER_PAGE = 1000
const MAX_USER_PAGES = 100

/** The one account whose subscriptions row holds `value` in `column`; none when no row or several do. */
async function findByStoredId(supabase: SupabaseClient, column: string, value: string | undefined): Promise<Found> {
  if (!value) return { id: null }
  const { data, error } = await supabase.from('subscriptions').select('user_id').eq(column, value).limit(2)
  if (error) return { error }
  return { id: data?.length === 1 ? (data[0].user_id as string) : null }
}

/** The account Polar names by `customer.external_id` (a Wispra user id given at checkout), if it exists. */
async function findByExternalId(supabase: SupabaseClient, externalId: string | null | undefined): Promise<Found> {
  if (!externalId || !UUID.test(externalId)) return { id: null }
  const { data, error } = await supabase.auth.admin.getUserById(externalId)
  if (error) return (error as { status?: number }).status === 404 ? { id: null } : { error }
  return { id: data?.user?.id ?? null }
}

/**
 * Pages through the accounts, 1000 at a time, until one has this email.
 * listUsers() with no page returns only the first 50 accounts.
 */
async function findByEmail(supabase: SupabaseClient, email: string | null | undefined): Promise<Found> {
  const wanted = email?.trim().toLowerCase()
  if (!wanted) return { id: null }
  for (let page = 1; page <= MAX_USER_PAGES; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: USERS_PER_PAGE })
    if (error) return { error }
    const users = data?.users ?? []
    const match = users.find(u => u.email?.toLowerCase() === wanted)
    if (match) return { id: match.id }
    if (users.length === 0 || ('nextPage' in data && data.nextPage === null)) return { id: null }
  }
  console.warn(`[webhook/polar] stopped looking for the buyer after ${MAX_USER_PAGES * USERS_PER_PAGE} accounts`)
  return { id: null }
}

/**
 * The Wispra account a subscription belongs to: the account already linked to
 * this subscription, then Polar's external_id, then the account already linked
 * to this Polar customer, then the buyer's email.
 */
async function findBuyer(supabase: SupabaseClient, sub: PolarEvent['data']): Promise<Found> {
  const steps = [
    () => findByStoredId(supabase, 'polar_subscription_id', sub.id),
    () => findByExternalId(supabase, sub.customer?.external_id),
    () => findByStoredId(supabase, 'polar_customer_id', sub.customer_id),
    () => findByEmail(supabase, sub.customer?.email ?? sub.customer_email),
  ]
  for (const step of steps) {
    const found = await step()
    if ('error' in found || found.id) return found
  }
  return { id: null }
}

const HANDLED = ['subscription.created', 'subscription.updated', 'subscription.canceled', 'subscription.revoked']

/**
 * Applies one event to the subscriptions table. Returns an error to have Polar retry.
 *
 * - created / updated / canceled: Pro while Polar says the subscription is `active`.
 *   A subscription canceled at the end of the period stays `active` until then,
 *   so the customer keeps Pro for the time already paid.
 * - revoked: the customer lost access (period over, canceled at once, or payment
 *   retries exhausted): Free at once.
 *
 * An event that takes Pro away only applies to the subscription the account is
 * linked to, so the end of another subscription does not end the one still paid.
 */
async function applyEvent(supabase: SupabaseClient, event: PolarEvent): Promise<{ error: unknown } | null> {
  if (!HANDLED.includes(event.type)) return null
  const sub = event.data
  if (!sub?.id) return null

  const found = await findBuyer(supabase, sub)
  if ('error' in found) return found
  if (!found.id) {
    console.warn(`[webhook/polar] no account for ${event.type} of subscription ${sub.id}`)
    return null
  }

  const { data: row, error: readError } = await supabase
    .from('subscriptions')
    .select('polar_subscription_id')
    .eq('user_id', found.id)
    .maybeSingle()
  if (readError) return { error: readError }

  const revoked = event.type === 'subscription.revoked'
  const pro = !revoked && sub.status === 'active'
  const linked = row?.polar_subscription_id
  if (!pro && linked && linked !== sub.id) return null

  if (revoked) {
    const { error } = await supabase
      .from('subscriptions')
      .update({ plan: 'free', updated_at: new Date().toISOString() })
      .eq('user_id', found.id)
    return error ? { error } : null
  }

  const { error } = await supabase
    .from('subscriptions')
    .upsert({
      user_id: found.id,
      plan: pro ? 'pro' : 'free',
      polar_subscription_id: sub.id,
      polar_customer_id: sub.customer_id,
      current_period_end: sub.current_period_end ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })
  return error ? { error } : null
}

export async function POST(req: NextRequest) {
  const body = await req.text()

  const check = verifyPolarWebhook(req.headers, body, process.env.POLAR_WEBHOOK_SECRET)
  if (!check.ok) {
    console.warn(`[webhook/polar] refused: ${check.reason}`)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let event: PolarEvent
  try {
    event = JSON.parse(body) as PolarEvent
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  if (!event || typeof event.type !== 'string') {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const supabase = createAdminClient()

  const claim = await claimDelivery(supabase, check.id, event.type)
  if (typeof claim === 'object') return serverError('Could not record the webhook', claim.error)
  if (claim === 'duplicate') return NextResponse.json({ ok: true, duplicate: true })

  const failed = await applyEvent(supabase, event)
  if (failed) {
    // Forget the delivery so Polar's retry (same webhook-id) is applied.
    if (claim === 'claimed') await supabase.from('webhook_events').delete().eq('webhook_id', check.id)
    return serverError('Could not apply the webhook', failed.error)
  }

  return NextResponse.json({ ok: true })
}
