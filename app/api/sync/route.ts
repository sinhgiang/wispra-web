import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, validateToken } from '@/lib/supabase-server'
import { MOBILE_ID_PREFIX } from '@/lib/history'

interface HistoryRow {
  id: string
  text: string
  rawText?: string | null
  createdAt: string
  app?: string | null
  topic?: string | null
  language?: string | null
  durationSeconds?: number | null
}

interface LexiconRow {
  id: string
  term: string
  heardAs?: unknown
  count?: number | null
  enabled?: boolean | null
  pinned?: boolean | null
  source?: string | null
  createdAt?: string | null
  lastSeen?: string | null
}

interface MeetingRow {
  id: string
  title?: string | null
  summary?: string | null
  createdAt: string
  durationMs?: number | null
  status?: string | null
  segments?: unknown
  content?: unknown
  languageConfig?: unknown
  spaceId?: string | null
}

interface SyncRequestBody {
  history?: HistoryRow[]
  lexicon?: LexiconRow[]
  meetings?: MeetingRow[]
}

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

  const supabase = createAdminClient()
  const synced = { history: 0, lexicon: 0, meetings: 0 }

  // History: full replace of the desktop's entries — the desktop app always sends
  // its complete local snapshot (capped at 100 entries there), never a partial diff.
  // Entries from the mobile app (id starting with MOBILE_ID_PREFIX, added through
  // /api/history/merge) are not the desktop's to replace and are kept.
  if (body.history) {
    const { error: deleteError } = await supabase
      .from('synced_history')
      .delete()
      .eq('user_id', userId)
      .not('id', 'like', `${MOBILE_ID_PREFIX}%`)
    if (deleteError) {
      return NextResponse.json({ error: `History sync failed: ${deleteError.message}` }, { status: 500 })
    }
    if (body.history.length > 0) {
      const rows = body.history.map((entry) => ({
        user_id: userId,
        id: entry.id,
        text: entry.text,
        raw_text: entry.rawText ?? null,
        created_at: entry.createdAt,
        app: entry.app ?? null,
        topic: entry.topic ?? null,
        language: entry.language ?? null,
        duration_seconds: entry.durationSeconds ?? null,
      }))
      const { error: insertError } = await supabase.from('synced_history').insert(rows)
      if (insertError) {
        return NextResponse.json({ error: `History sync failed: ${insertError.message}` }, { status: 500 })
      }
    }
    synced.history = body.history.length
  }

  // Lexicon: full replace, same rationale as History (capped at 500 entries locally).
  if (body.lexicon) {
    const { error: deleteError } = await supabase.from('synced_lexicon').delete().eq('user_id', userId)
    if (deleteError) {
      return NextResponse.json({ error: `Lexicon sync failed: ${deleteError.message}` }, { status: 500 })
    }
    if (body.lexicon.length > 0) {
      const rows = body.lexicon.map((entry) => ({
        user_id: userId,
        id: entry.id,
        term: entry.term,
        heard_as: entry.heardAs ?? null,
        count: entry.count ?? null,
        enabled: entry.enabled ?? null,
        pinned: entry.pinned ?? null,
        source: entry.source ?? null,
        created_at: entry.createdAt ?? null,
        last_seen: entry.lastSeen ?? null,
      }))
      const { error: insertError } = await supabase.from('synced_lexicon').insert(rows)
      if (insertError) {
        return NextResponse.json({ error: `Lexicon sync failed: ${insertError.message}` }, { status: 500 })
      }
    }
    synced.lexicon = body.lexicon.length
  }

  // Meetings: upsert per session — the desktop app sends only sessions changed
  // since the last sync, not a full snapshot. A meeting deleted locally is not
  // removed from the cloud in this version (documented limitation).
  if (body.meetings && body.meetings.length > 0) {
    const rows = body.meetings.map((session) => ({
      user_id: userId,
      id: session.id,
      title: session.title ?? null,
      summary: session.summary ?? null,
      created_at: session.createdAt,
      duration_ms: session.durationMs ?? null,
      status: session.status ?? null,
      segments: session.segments ?? null,
      content: session.content ?? null,
      language_config: session.languageConfig ?? null,
      space_id: session.spaceId ?? null,
    }))
    const { error: upsertError } = await supabase
      .from('synced_meetings')
      .upsert(rows, { onConflict: 'user_id,id' })
    if (upsertError) {
      return NextResponse.json({ error: `Meeting sync failed: ${upsertError.message}` }, { status: 500 })
    }
    synced.meetings = body.meetings.length
  }

  return NextResponse.json({ ok: true, synced })
}
