import { NextRequest, NextResponse } from 'next/server'
import { serverError } from '@/lib/api-errors'
import { createAdminClient, validateToken } from '@/lib/supabase-server'
import { checkedLexicon, cleanVocabulary, fromLexiconRow, replaceLexicon, type LexiconEntry } from '@/lib/lexicon'
import { isMissingTable } from '@/lib/history-deletions'
import { readAllPages } from '@/lib/supabase-paging'

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
    return serverError('Could not read the vocabulary', vocab.error.message)
  }
  if (lexicon.error) {
    return serverError('Could not read learned words', lexicon.error.message)
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
    // The same id twice: the last one wins.
    const checked = checkedLexicon(body.lexicon)
    if ('error' in checked) return NextResponse.json({ error: checked.error }, { status: 400 })
    entries = checked.entries
  }

  const supabase = createAdminClient()
  const now = new Date().toISOString()

  if (terms !== undefined) {
    const { error } = await supabase
      .from('synced_vocabulary')
      .upsert({ user_id: userId, terms, updated_at: now }, { onConflict: 'user_id' })
    if (error) {
      const status = isMissingTable(error) ? 503 : 500
      return serverError('Could not save the vocabulary', error.message, status)
    }
  }

  if (entries !== undefined) {
    // Written first, then what the list no longer has is removed: a failure part
    // way leaves the old words in place rather than an empty list.
    const error = await replaceLexicon(supabase, userId, entries, now)
    if (error) return serverError('Could not save learned words', error.message)
  }

  return NextResponse.json({
    ok: true,
    ...(terms !== undefined ? { vocabulary: terms.length } : {}),
    ...(entries !== undefined ? { lexicon: entries.length } : {}),
  })
}
