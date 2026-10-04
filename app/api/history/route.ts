import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, validateToken } from '@/lib/supabase-server'
import { fromRow, HISTORY_PAGE_DEFAULT, HISTORY_PAGE_MAX } from '@/lib/history'
import { CLEAR_ALL_ID, getDeletions, recordDeletions } from '@/lib/history-deletions'

/** The signed-in user's id, or a 401 response. */
async function signedInUser(req: NextRequest): Promise<string | NextResponse> {
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = await validateToken(authHeader.slice(7))
  if (!userId) {
    return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 })
  }
  return userId
}

// GET /api/history — the signed-in user's synced dictation history, newest first.
// Read-only. Query: ?limit=1..500 (default 100) and ?before=<ISO date> to page to
// older entries (pass the previous page's `nextBefore`); ?since=<ISO date> limits
// `deleted` to the ids deleted since then (pass the previous answer's `serverTime`).
export async function GET(req: NextRequest) {
  const userId = await signedInUser(req)
  if (typeof userId !== 'string') return userId

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
  const since = params.get('since')
  if (since !== null && Number.isNaN(Date.parse(since))) {
    return NextResponse.json({ error: 'since must be an ISO date' }, { status: 400 })
  }

  // Taken before anything is read: a deletion made while this request runs is
  // reported again next time rather than missed.
  const serverTime = new Date().toISOString()

  const supabase = createAdminClient()
  // Always scoped to the token's user: there is no way to ask for someone else's rows.
  let query = supabase.from('synced_history').select('*').eq('user_id', userId)
  if (before !== null) query = query.lt('created_at', new Date(before).toISOString())
  const [{ data, error }, deletionsResult] = await Promise.all([
    query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1),
    getDeletions(supabase, userId),
  ])

  if (error) {
    return NextResponse.json({ error: `Could not read history: ${error.message}` }, { status: 500 })
  }
  // Without the deletions a device would move its `since` past them and never hear of them.
  if (!deletionsResult.ok) {
    return NextResponse.json({ error: `Could not read deleted entries: ${deletionsResult.error}` }, { status: 500 })
  }
  const deletions = deletionsResult.deletions

  const rows = (data ?? []) as Parameters<typeof fromRow>[0][]
  const page = rows.slice(0, limit).map(fromRow)
  const nextBefore = rows.length > limit ? page[page.length - 1].createdAt : null
  const sinceMs = since === null ? null : Date.parse(since)
  const deleted = deletions.entries.filter(d => sinceMs === null || Date.parse(d.deletedAt) >= sinceMs)

  return NextResponse.json({ entries: page, nextBefore, deleted, clearedAt: deletions.clearedAt, serverTime })
}

// DELETE /api/history — deletes the signed-in user's whole history, on every
// device: body must be exactly { "all": true }. Records the moment as a "clear",
// so entries created before it are not brought back by any device's sync.
export async function DELETE(req: NextRequest) {
  const userId = await signedInUser(req)
  if (typeof userId !== 'string') return userId

  let body: { all?: unknown }
  try {
    body = await req.json()
  } catch {
    body = {}
  }
  if (body?.all !== true) {
    return NextResponse.json(
      { error: 'To delete the whole history send { "all": true }. To delete one entry use DELETE /api/history/{id}.' },
      { status: 400 }
    )
  }

  const supabase = createAdminClient()
  const clearedAt = new Date().toISOString()

  const { data: existing, error: listError } = await supabase.from('synced_history').select('id').eq('user_id', userId)
  if (listError) {
    return NextResponse.json({ error: `Could not delete history: ${listError.message}` }, { status: 500 })
  }
  const ids = ((existing ?? []) as { id: string }[]).map(row => row.id)

  // The marks first: if they cannot be written, nothing is deleted (a deletion other
  // devices never hear of would come back with their next sync). Every entry in the
  // cloud gets its own mark, so it stays deleted whatever the clocks say; the clear
  // mark covers entries the server has not seen yet.
  const { error: markError } = await recordDeletions(supabase, userId, [...ids, CLEAR_ALL_ID], clearedAt)
  if (markError) {
    return NextResponse.json({ error: `Could not delete history: ${markError.message}` }, { status: 500 })
  }

  const { error } = await supabase.from('synced_history').delete().eq('user_id', userId)
  if (error) {
    return NextResponse.json({ error: `Could not delete history: ${error.message}` }, { status: 500 })
  }

  return NextResponse.json({ ok: true, deleted: ids.length, clearedAt })
}
