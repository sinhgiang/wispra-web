import { NextRequest, NextResponse } from 'next/server'
import { serverError } from '@/lib/api-errors'
import { createAdminClient, validateToken } from '@/lib/supabase-server'
import { HISTORY_MERGE_MAX, invalidEntry, toRow, type HistoryEntry } from '@/lib/history'
import { getDeletions, isDeleted } from '@/lib/history-deletions'

// POST /api/history/merge — adds or updates the signed-in user's history entries by
// id. Entries not in the request are left alone: nothing is ever deleted here, so
// entries from the desktop app stay. Body: { "entries": HistoryEntry[] } (1..500).
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const userId = await validateToken(authHeader.slice(7))
  if (!userId) {
    return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 })
  }

  let body: { entries?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const entries = body?.entries
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > HISTORY_MERGE_MAX) {
    return NextResponse.json({ error: `entries must be an array of 1 to ${HISTORY_MERGE_MAX} entries` }, { status: 400 })
  }
  for (let i = 0; i < entries.length; i++) {
    const problem = invalidEntry(entries[i])
    if (problem) return NextResponse.json({ error: `entries[${i}]: ${problem}` }, { status: 400 })
  }

  // The same id twice in one request: the last one wins (one upsert per id).
  const byId = new Map<string, HistoryEntry>()
  for (const entry of entries as HistoryEntry[]) byId.set(entry.id, entry)
  const supabase = createAdminClient()

  // Entries deleted on any device (or created before the last "delete everything")
  // are skipped, so a phone that has not heard of a deletion cannot bring one back.
  const deletionsResult = await getDeletions(supabase, userId)
  if (!deletionsResult.ok) {
    // Not knowing what was deleted, storing could bring a deleted entry back: store nothing.
    return serverError('Could not merge history', deletionsResult.error)
  }
  const deletions = deletionsResult.deletions
  const kept = [...byId.values()].filter(entry => !isDeleted(entry, deletions))
  const skipped = byId.size - kept.length

  if (kept.length > 0) {
    // user_id always comes from the token, never from the body.
    const rows = kept.map(entry => toRow(userId, entry))
    const { error } = await supabase.from('synced_history').upsert(rows, { onConflict: 'user_id,id' })
    if (error) {
      return serverError('Could not merge history', error.message)
    }
  }

  return NextResponse.json({ ok: true, merged: kept.length, ...(skipped > 0 ? { skippedDeleted: skipped } : {}) })
}
