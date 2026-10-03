import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, validateToken, currentMonth } from '@/lib/supabase-server'
import { getAiQuotaStatus } from '@/lib/ai-quota'
import { getAccount } from '@/lib/account'

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

  const [account, { data: usage }, aiQuota] = await Promise.all([
    getAccount(supabase, userId),
    supabase.from('usage').select('seconds_used').eq('user_id', userId).eq('month', month).single(),
    getAiQuotaStatus(supabase, userId),
  ])

  const { plan, unlimited } = account
  const secondsUsed = usage?.seconds_used ?? 0
  const limitSeconds = plan === 'pro' || unlimited ? null : FREE_LIMIT_SECONDS

  return NextResponse.json({
    plan,
    unlimited,
    usageSeconds: secondsUsed,
    limitSeconds,
    aiTokensUsed: aiQuota.usedTokens,
    aiTokensLimit: aiQuota.limitTokens,
    aiTokensResetAt: aiQuota.resetAt,
    currentPeriodEnd: account.currentPeriodEnd,
    subscribeUrl: process.env.POLAR_CHECKOUT_URL ?? null,
  })
}
