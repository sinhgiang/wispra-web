import type { SupabaseClient } from '@supabase/supabase-js'
import { chunks, readAllPages } from '@/lib/supabase-paging'

// Custom Vocabulary (public.synced_vocabulary) and Learned words
// (public.synced_lexicon), per account, for GET / PUT /api/lexicon.
// Learned entries have the same shape the desktop app sends to /api/sync.

/** One learned word, as the apps send and receive it. */
export interface LexiconEntry {
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

/** Learned words returned by GET also say when the server last stored them. */
export interface StoredLexiconEntry extends LexiconEntry {
  syncedAt: string
}

/** Most Custom Vocabulary terms one account keeps. */
export const VOCABULARY_MAX = 2000
/** Most learned words one PUT may carry (the desktop keeps up to 500). */
export const LEXICON_MAX = 2000
const TERM_MAX = 200
const ID_MAX = 200

interface LexiconRowDb {
  id: string
  term: string
  heard_as: unknown
  count: number | null
  enabled: boolean | null
  pinned: boolean | null
  source: string | null
  created_at: string | null
  last_seen: string | null
  synced_at: string
}

const iso = (value: string | null) => (value === null ? null : new Date(value).toISOString())

export function fromLexiconRow(row: LexiconRowDb): StoredLexiconEntry {
  return {
    id: row.id,
    term: row.term,
    heardAs: row.heard_as,
    count: row.count,
    enabled: row.enabled,
    pinned: row.pinned,
    source: row.source,
    createdAt: iso(row.created_at),
    lastSeen: iso(row.last_seen),
    syncedAt: new Date(row.synced_at).toISOString(),
  }
}

export function toLexiconRow(userId: string, entry: LexiconEntry, now: string) {
  return {
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
    synced_at: now,
  }
}

const isDate = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && !Number.isNaN(Date.parse(v)))
const isOptional = (v: unknown, type: 'string' | 'boolean' | 'number') => v === undefined || v === null || typeof v === type

/** Why a learned word cannot be stored, or null when it is fine. */
export function invalidLexiconEntry(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'each entry must be an object'
  const e = value as Record<string, unknown>
  if (typeof e.id !== 'string' || !e.id.trim() || e.id.length > ID_MAX) return `"id" must be a non-empty string of at most ${ID_MAX} characters`
  if (typeof e.term !== 'string' || !e.term.trim() || e.term.length > TERM_MAX) return `"term" must be a non-empty string of at most ${TERM_MAX} characters`
  if (!isOptional(e.count, 'number') || (typeof e.count === 'number' && !Number.isFinite(e.count))) return '"count" must be a number or null'
  if (!isOptional(e.enabled, 'boolean')) return '"enabled" must be true, false or null'
  if (!isOptional(e.pinned, 'boolean')) return '"pinned" must be true, false or null'
  if (!isOptional(e.source, 'string') || (typeof e.source === 'string' && e.source.length > TERM_MAX)) return '"source" must be a short string or null'
  if (!isDate(e.createdAt)) return '"createdAt" must be an ISO date or null'
  if (!isDate(e.lastSeen)) return '"lastSeen" must be an ISO date or null'
  if (e.heardAs !== undefined && e.heardAs !== null && JSON.stringify(e.heardAs).length > 20_000) return '"heardAs" is too large'
  return null
}

/**
 * The Custom Vocabulary list to store: trimmed, empty terms dropped, exact
 * duplicates removed (first one kept), in the order given; or why it is invalid.
 */
export function cleanVocabulary(value: unknown): { terms: string[] } | { error: string } {
  if (!Array.isArray(value)) return { error: '"vocabulary" must be an array of strings' }
  const terms: string[] = []
  const seen = new Set<string>()
  for (let i = 0; i < value.length; i++) {
    const term = value[i]
    if (typeof term !== 'string') return { error: `vocabulary[${i}] must be a string` }
    const trimmed = term.trim()
    if (trimmed.length > TERM_MAX) return { error: `vocabulary[${i}] is longer than ${TERM_MAX} characters` }
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    terms.push(trimmed)
  }
  if (terms.length > VOCABULARY_MAX) return { error: `at most ${VOCABULARY_MAX} vocabulary terms` }
  return { terms }
}

/**
 * Makes `entries` the user's whole learned-word list: writes them first, then
 * removes the ids the list no longer has, so a failure part way keeps the old
 * words instead of leaving an empty list. Used by PUT /api/lexicon and /api/sync.
 */
export async function replaceLexicon(
  supabase: SupabaseClient,
  userId: string,
  entries: LexiconEntry[],
  now: string
): Promise<{ message: string } | null> {
  for (const part of chunks(entries.map(entry => toLexiconRow(userId, entry, now)))) {
    const { error } = await supabase.from('synced_lexicon').upsert(part, { onConflict: 'user_id,id' })
    if (error) return error
  }
  const existing = await readAllPages<{ id: string }, { message: string }>((from, to) =>
    supabase.from('synced_lexicon').select('id').eq('user_id', userId).order('id', { ascending: true }).range(from, to)
  )
  if (existing.error) return existing.error
  const keep = new Set(entries.map(e => e.id))
  const stale = existing.data.map(r => r.id).filter(id => !keep.has(id))
  for (const part of chunks(stale)) {
    const { error } = await supabase.from('synced_lexicon').delete().eq('user_id', userId).in('id', part)
    if (error) return error
  }
  return null
}

/** The list to store: every entry checked, the same id twice keeps the last; or why not. */
export function checkedLexicon(value: unknown): { entries: LexiconEntry[] } | { error: string } {
  if (!Array.isArray(value) || value.length > LEXICON_MAX) {
    return { error: `"lexicon" must be an array of at most ${LEXICON_MAX} entries` }
  }
  for (let i = 0; i < value.length; i++) {
    const problem = invalidLexiconEntry(value[i])
    if (problem) return { error: `lexicon[${i}]: ${problem}` }
  }
  const byId = new Map<string, LexiconEntry>()
  for (const entry of value as LexiconEntry[]) byId.set(entry.id, entry)
  return { entries: [...byId.values()] }
}
