import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'

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

async function verifySignature(req: NextRequest, body: string): Promise<boolean> {
  const secret = process.env.POLAR_WEBHOOK_SECRET
  if (!secret) return false

  const signature = req.headers.get('webhook-signature') ?? req.headers.get('x-polar-signature')
  if (!signature) return false

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  )

  const sigBytes = hexToBytes(signature.replace(/^sha256=/, ''))
  const bodyBytes = new TextEncoder().encode(body)
  // Cast needed: Node 22 Uint8Array<ArrayBufferLike> vs WebCrypto BufferSource<ArrayBuffer>
  return crypto.subtle.verify('HMAC', key, sigBytes.buffer as ArrayBuffer, bodyBytes.buffer as ArrayBuffer)
}

function hexToBytes(hex: string): Uint8Array {
  const arr = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    arr[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  }
  return arr
}

export async function POST(req: NextRequest) {
  const body = await req.text()

  const valid = await verifySignature(req, body)
  if (!valid) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const event = JSON.parse(body) as PolarEvent
  const supabase = createAdminClient()

  // Polar event types: subscription.created, subscription.updated, subscription.canceled
  if (event.type === 'subscription.created' || event.type === 'subscription.updated') {
    const isActive = event.data.status === 'active'
    const email = event.data.customer_email
    if (!email) return NextResponse.json({ ok: true })

    // Find user by email
    const { data: users } = await supabase.auth.admin.listUsers()
    const user = users?.users?.find(u => u.email === email)
    if (!user) return NextResponse.json({ ok: true })

    await supabase
      .from('subscriptions')
      .upsert({
        user_id: user.id,
        plan: isActive ? 'pro' : 'free',
        polar_subscription_id: event.data.id,
        polar_customer_id: event.data.customer_id,
        current_period_end: event.data.current_period_end ?? null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' })
  }

  if (event.type === 'subscription.canceled') {
    const email = event.data.customer_email
    if (!email) return NextResponse.json({ ok: true })

    const { data: users } = await supabase.auth.admin.listUsers()
    const user = users?.users?.find(u => u.email === email)
    if (!user) return NextResponse.json({ ok: true })

    await supabase
      .from('subscriptions')
      .update({ plan: 'free', updated_at: new Date().toISOString() })
      .eq('user_id', user.id)
  }

  return NextResponse.json({ ok: true })
}
