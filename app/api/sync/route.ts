import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, validateToken } from '@/lib/supabase-server'
import { HISTORY_SYNC_MAX, invalidEntry, MOBILE_ID_PREFIX, toRow, type HistoryEntry } from '@/lib/history'
import { getDeletions, isDeleted } from '@/lib/history-deletions'
import { checkedLexicon, replaceLexicon, type LexiconEntry } from '@/lib/lexicon'
import { invalidMeeting, MEETINGS_SYNC_MAX, toMeetingRow, type MeetingEntry } from '@/lib/meetings'
import { chunks, readAllPages } from '@/lib/supabase-paging'

interface SyncRequestBody {
  history?: unknown
  lexicon?: unknown
  meetings?: unknown
}

const bad = (error: string) => NextResponse.json({ error }, { status: 400 })

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const token = authHeader.slice(7)
  const userId = await validateToken(token)
  if (!userId) {
    return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 })
  }

  let body: SyncRequestBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return bad('Body must be a JSON object')

  // Everything is checked before anything is deleted or written (T-0201, T4): a
  // malformed request used to wipe the desktop's history and then fail.
  let history: HistoryEntry[] | undefined
  if (body.history !== undefined && body.history !== null) {
    if (!Array.isArray(body.history) || body.history.length > HISTORY_SYNC_MAX) {
      return bad(`"history" must be an array of at most ${HISTORY_SYNC_MAX} entries`)
    }
    for (let i = 0; i < body.history.length; i++) {
      const problem = invalidEntry(body.history[i], { mobileOnly: false })
      if (problem) return bad(`history[${i}]: ${problem}`)
    }
    // The same id twice: the last one wins.
    const byId = new Map<string, HistoryEntry>()
    for (const entry of body.history as HistoryEntry[]) byId.set(entry.id, entry)
    history = [...byId.values()]
  }
  let lexicon: LexiconEntry[] | undefined
  if (body.lexicon !== undefined && body.lexicon !== null) {
    const checked = checkedLexicon(body.lexicon)
    if ('error' in checked) return bad(checked.error)
    lexicon = checked.entries
  }
  let meetings: MeetingEntry[] | undefined
  if (body.meetings !== undefined && body.meetings !== null) {
    if (!Array.isArray(body.meetings) || body.meetings.length > MEETINGS_SYNC_MAX) {
      return bad(`"meetings" must be an array of at most ${MEETINGS_SYNC_MAX} sessions`)
    }
    for (let i = 0; i < body.meetings.length; i++) {
      const problem = invalidMeeting(body.meetings[i])
      if (problem) return bad(`meetings[${i}]: ${problem}`)
    }
    const byId = new Map<string, MeetingEntry>()
    for (const session of body.meetings as MeetingEntry[]) byId.set(session.id, session)
    meetings = [...byId.values()]
  }

  const supabase = createAdminClient()
  const synced = { history: 0, lexicon: 0, meetings: 0 }
  /** History entries sent but not stored because they were deleted on some device. */
  let historySkipped = 0

  // History: the desktop always sends its complete local snapshot (capped at 100
  // entries there), never a partial diff, so its entries in the cloud become exactly
  // that snapshot. Entries from the mobile app (id starting with MOBILE_ID_PREFIX,
  // added through /api/history/merge) are not the desktop's to replace: they are
  // kept, and a copy the desktop sends never overwrites them.
  if (history) {
    // Entries deleted on any device (or created before the last "delete everything")
    // are not stored again, even though this desktop may not know of the deletion yet.
    // Read before anything is touched: if it fails, nothing is deleted or written.
    const deletionsResult = await getDeletions(supabase, userId)
    if (!deletionsResult.ok) {
      return NextResponse.json({ error: `History sync failed: ${deletionsResult.error}` }, { status: 500 })
    }
    const deletions = deletionsResult.deletions
    const kept = history.filter(entry => !isDeleted(entry, deletions))
    const desktopRows = kept.filter(e => !e.id.startsWith(MOBILE_ID_PREFIX)).map(e => toRow(userId, e))
    const phoneRows = kept.filter(e => e.id.startsWith(MOBILE_ID_PREFIX)).map(e => toRow(userId, e))

    // Written first, then the desktop entries the snapshot no longer has are
    // removed: a failure part way keeps the old entries instead of none.
    for (const part of chunks(desktopRows)) {
      const { error } = await supabase.from('synced_history').upsert(part, { onConflict: 'user_id,id' })
      if (error) return NextResponse.json({ error: `History sync failed: ${error.message}` }, { status: 500 })
    }
    for (const part of chunks(phoneRows)) {
      const { error } = await supabase
        .from('synced_history')
        .upsert(part, { onConflict: 'user_id,id', ignoreDuplicates: true })
      if (error) return NextResponse.json({ error: `History sync failed: ${error.message}` }, { status: 500 })
    }
    const existing = await readAllPages<{ id: string }, { message: string }>((from, to) =>
      supabase
        .from('synced_history')
        .select('id')
        .eq('user_id', userId)
        .not('id', 'like', `${MOBILE_ID_PREFIX}%`)
        .order('id', { ascending: true })
        .range(from, to)
    )
    if (existing.error) {
      return NextResponse.json({ error: `History sync failed: ${existing.error.message}` }, { status: 500 })
    }
    const keep = new Set(desktopRows.map(r => r.id))
    const stale = existing.data.map(r => r.id).filter(id => !keep.has(id))
    for (const part of chunks(stale)) {
      const { error } = await supabase.from('synced_history').delete().eq('user_id', userId).in('id', part)
      if (error) return NextResponse.json({ error: `History sync failed: ${error.message}` }, { status: 500 })
    }
    synced.history = kept.length
    historySkipped = history.length - kept.length
  }

  // Lexicon: the desktop's whole list (capped at 500 entries locally).
  if (lexicon) {
    const error = await replaceLexicon(supabase, userId, lexicon, new Date().toISOString())
    if (error) return NextResponse.json({ error: `Lexicon sync failed: ${error.message}` }, { status: 500 })
    synced.lexicon = lexicon.length
  }

  // Meetings: upsert per session — the desktop app sends only sessions changed
  // since the last sync, not a full snapshot. A meeting deleted locally is not
  // removed from the cloud in this version (documented limitation).
  if (meetings && meetings.length > 0) {
    const { error: upsertError } = await supabase
      .from('synced_meetings')
      .upsert(meetings.map(session => toMeetingRow(userId, session)), { onConflict: 'user_id,id' })
    if (upsertError) {
      return NextResponse.json({ error: `Meeting sync failed: ${upsertError.message}` }, { status: 500 })
    }
    synced.meetings = meetings.length
  }

  return NextResponse.json({ ok: true, synced, ...(historySkipped > 0 ? { historySkipped } : {}) })
}
