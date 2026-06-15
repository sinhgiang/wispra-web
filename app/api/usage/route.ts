import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, validateToken, currentMonth } from '@/lib/supabase-server'

const FREE_LIMIT_SECONDS = 30 * 60

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const token = authHeader.slice(7)
  const userId = await validateToken(token)
  if (!userId) {
    return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const month = currentMonth()

  const [{ data: sub }, { data: usage }] = await Promise.all([
    supabase.from('subscriptions').select('plan, current_period_end').eq('user_id', userId).single(),
    supabase.from('usage').select('seconds_used').eq('user_id', userId).eq('month', month).single(),
  ])

  const plan = sub?.plan ?? 'free'
  const secondsUsed = usage?.seconds_used ?? 0
  const limitSeconds = plan === 'pro' ? null : FREE_LIMIT_SECONDS

  return NextResponse.json({
    plan,
    usageSeconds: secondsUsed,
    limitSeconds,
    currentPeriodEnd: sub?.current_period_end ?? null,
    subscribeUrl: process.env.POLAR_CHECKOUT_URL ?? null,
  })
}
