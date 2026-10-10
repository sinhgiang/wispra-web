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
    customer_email?: string
    status: string
    current_period_end?: string
    metadata?: Record<string, string>
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

async function findUserIdByEmail(supabase: SupabaseClient, email: string): Promise<{ id: string | null } | { error: unknown }> {
  const { data, error } = await supabase.auth.admin.listUsers()
  if (error) return { error }
  return { id: data?.users?.find(u => u.email === email)?.id ?? null }
}

/** Applies one event to the subscriptions table. Returns an error to have Polar retry. */
async function applyEvent(supabase: SupabaseClient, event: PolarEvent): Promise<{ error: unknown } | null> {
  // Polar event types: subscription.created, subscription.updated, subscription.canceled
  const handled = ['subscription.created', 'subscription.updated', 'subscription.canceled']
  if (!handled.includes(event.type)) return null

  const email = event.data?.customer_email
  if (!email) return null

  const found = await findUserIdByEmail(supabase, email)
  if ('error' in found) return found
  if (!found.id) return null

  if (event.type === 'subscription.canceled') {
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
      plan: event.data.status === 'active' ? 'pro' : 'free',
      polar_subscription_id: event.data.id,
      polar_customer_id: event.data.customer_id,
      current_period_end: event.data.current_period_end ?? null,
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
