import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, validateToken } from '@/lib/supabase-server'
import {
  cleanVocabulary,
  fromLexiconRow,
  invalidLexiconEntry,
  LEXICON_MAX,
  toLexiconRow,
  type LexiconEntry,
} from '@/lib/lexicon'
import { isMissingTable } from '@/lib/history-deletions'
import { chunks, readAllPages } from '@/lib/supabase-paging'

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

// GET /api/lexicon — the signed-in user's Custom Vocabulary and Learned words.
// Always scoped to the token's user: nothing in the request can name another one.
export async function GET(req: NextRequest) {
  const userId = await signedInUser(req)
  if (typeof userId !== 'string') return userId

  const supabase = createAdminClient()
  const [vocab, lexicon] = await Promise.all([
    supabase.from('synced_vocabulary').select('terms, updated_at').eq('user_id', userId).maybeSingle(),
    readAllPages<Parameters<typeof fromLexiconRow>[0], { message: string }>((from, to) =>
      supabase.from('synced_lexicon').select('*').eq('user_id', userId).order('id', { ascending: true }).range(from, to)
    ),
  ])

  // Before migration 009 the vocabulary table does not exist: an empty list.
  if (vocab.error && !isMissingTable(vocab.error)) {
    return NextResponse.json({ error: `Could not read the vocabulary: ${vocab.error.message}` }, { status: 500 })
  }
  if (lexicon.error) {
    return NextResponse.json({ error: `Could not read learned words: ${lexicon.error.message}` }, { status: 500 })
  }

  const row = vocab.error ? null : (vocab.data as { terms: string[]; updated_at: string } | null)
  return NextResponse.json({
    vocabulary: {
      terms: row?.terms ?? [],
      updatedAt: row ? new Date(row.updated_at).toISOString() : null,
    },
    lexicon: lexicon.data.map(fromLexiconRow),
  })
}

// PUT /api/lexicon — stores the signed-in user's merged lists. Body:
//   { "vocabulary"?: string[], "lexicon"?: LexiconEntry[] }
// Each list that is present replaces the stored one; a list that is left out is
// not touched. The apps merge before writing (see docs/LEXICON_API.md).
export async function PUT(req: NextRequest) {
  const userId = await signedInUser(req)
  if (typeof userId !== 'string') return userId

  let body: { vocabulary?: unknown; lexicon?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!body || typeof body !== 'object' || (body.vocabulary === undefined && body.lexicon === undefined)) {
    return NextResponse.json({ error: 'Send "vocabulary", "lexicon" or both' }, { status: 400 })
  }

  // Check everything before writing anything.
  let terms: string[] | undefined
  if (body.vocabulary !== undefined) {
    const cleaned = cleanVocabulary(body.vocabulary)
    if ('error' in cleaned) return NextResponse.json({ error: cleaned.error }, { status: 400 })
    terms = cleaned.terms
  }
  let entries: LexiconEntry[] | undefined
  if (body.lexicon !== undefined) {
    if (!Array.isArray(body.lexicon) || body.lexicon.length > LEXICON_MAX) {
      return NextResponse.json({ error: `"lexicon" must be an array of at most ${LEXICON_MAX} entries` }, { status: 400 })
    }
    for (let i = 0; i < body.lexicon.length; i++) {
      const problem = invalidLexiconEntry(body.lexicon[i])
      if (problem) return NextResponse.json({ error: `lexicon[${i}]: ${problem}` }, { status: 400 })
    }
    // The same id twice: the last one wins.
    const byId = new Map<string, LexiconEntry>()
    for (const entry of body.lexicon as LexiconEntry[]) byId.set(entry.id, entry)
    entries = [...byId.values()]
  }

  const supabase = createAdminClient()
  const now = new Date().toISOString()

  if (terms !== undefined) {
    const { error } = await supabase
      .from('synced_vocabulary')
      .upsert({ user_id: userId, terms, updated_at: now }, { onConflict: 'user_id' })
    if (error) {
      const status = isMissingTable(error) ? 503 : 500
      return NextResponse.json({ error: `Could not save the vocabulary: ${error.message}` }, { status })
    }
  }

  if (entries !== undefined) {
    // Write the new list first, then remove what it no longer has: a failure part
    // way leaves the old words in place rather than an empty list.
    for (const part of chunks(entries.map(entry => toLexiconRow(userId, entry, now)))) {
      const { error } = await supabase.from('synced_lexicon').upsert(part, { onConflict: 'user_id,id' })
      if (error) return NextResponse.json({ error: `Could not save learned words: ${error.message}` }, { status: 500 })
    }
    const existing = await readAllPages<{ id: string }, { message: string }>((from, to) =>
      supabase.from('synced_lexicon').select('id').eq('user_id', userId).order('id', { ascending: true }).range(from, to)
    )
    if (existing.error) {
      return NextResponse.json({ error: `Could not save learned words: ${existing.error.message}` }, { status: 500 })
    }
    const keep = new Set(entries.map(e => e.id))
    const stale = existing.data.map(r => r.id).filter(id => !keep.has(id))
    for (const part of chunks(stale)) {
      const { error } = await supabase.from('synced_lexicon').delete().eq('user_id', userId).in('id', part)
      if (error) return NextResponse.json({ error: `Could not save learned words: ${error.message}` }, { status: 500 })
    }
  }

  return NextResponse.json({
    ok: true,
    ...(terms !== undefined ? { vocabulary: terms.length } : {}),
    ...(entries !== undefined ? { lexicon: entries.length } : {}),
  })
}
