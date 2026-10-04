import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, validateToken } from '@/lib/supabase-server'
import { fromRow, HISTORY_PAGE_DEFAULT, HISTORY_PAGE_MAX } from '@/lib/history'

// GET /api/history — the signed-in user's synced dictation history, newest first.
// Read-only. Query: ?limit=1..500 (default 100) and ?before=<ISO date> to page to
// older entries (pass the previous page's `nextBefore`).
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const userId = await validateToken(authHeader.slice(7))
  if (!userId) {
    return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 })
  }

  const params = req.nextUrl.searchParams
  const limitParam = params.get('limit')
  const limit = limitParam === null ? HISTORY_PAGE_DEFAULT : Number(limitParam)
  if (!Number.isInteger(limit) || limit < 1 || limit > HISTORY_PAGE_MAX) {
    return NextResponse.json({ error: `limit must be an integer from 1 to ${HISTORY_PAGE_MAX}` }, { status: 400 })
  }
  const before = params.get('before')
  if (before !== null && Number.isNaN(Date.parse(before))) {
    return NextResponse.json({ error: 'before must be an ISO date' }, { status: 400 })
  }

  const supabase = createAdminClient()
  // Always scoped to the token's user: there is no way to ask for someone else's rows.
  let query = supabase.from('synced_history').select('*').eq('user_id', userId)
  if (before !== null) query = query.lt('created_at', new Date(before).toISOString())
  const { data, error } = await query
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1)

  if (error) {
    return NextResponse.json({ error: `Could not read history: ${error.message}` }, { status: 500 })
  }

  const rows = (data ?? []) as Parameters<typeof fromRow>[0][]
  const page = rows.slice(0, limit).map(fromRow)
  const nextBefore = rows.length > limit ? page[page.length - 1].createdAt : null
  return NextResponse.json({ entries: page, nextBefore })
}
