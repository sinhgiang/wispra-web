// Dictation history shared between the desktop and mobile apps (public.synced_history).
// The desktop app replaces its own entries through /api/sync; the mobile app reads
// everything through GET /api/history and adds or updates its own entries (ids
// starting with MOBILE_ID_PREFIX) through POST /api/history/merge, which never
// deletes anything.

/** One history entry as the apps send and receive it (same shape as /api/sync). */
export interface HistoryEntry {
  id: string
  text: string
  rawText?: string | null
  createdAt: string
  app?: string | null
  topic?: string | null
  language?: string | null
  durationSeconds?: number | null
}

/** Entries returned by GET /api/history also say when the server last stored them. */
export interface StoredHistoryEntry extends HistoryEntry {
  syncedAt: string
}

/**
 * Every entry the mobile app stores starts its id with this. /api/sync (the
 * desktop's full replace) leaves these entries alone, and /api/history/merge
 * accepts only these ids, so the phone can never overwrite a desktop entry and
 * the desktop can never wipe a phone entry. No `_` or `%`: it is used in a LIKE.
 */
export const MOBILE_ID_PREFIX = 'mobile-'

export const HISTORY_PAGE_DEFAULT = 100
export const HISTORY_PAGE_MAX = 500
/** Most entries one merge request may carry. */
export const HISTORY_MERGE_MAX = 500
/** Most entries one desktop /api/sync snapshot may carry (the desktop keeps 100). */
export const HISTORY_SYNC_MAX = 1000

const ID_MAX = 200
const TEXT_MAX = 100_000
const SHORT_MAX = 200

interface HistoryRowDb {
  id: string
  text: string
  raw_text: string | null
  created_at: string
  app: string | null
  topic: string | null
  language: string | null
  duration_seconds: number | string | null
  synced_at: string
}

export function fromRow(row: HistoryRowDb): StoredHistoryEntry {
  return {
    id: row.id,
    text: row.text,
    rawText: row.raw_text,
    createdAt: new Date(row.created_at).toISOString(),
    app: row.app,
    topic: row.topic,
    language: row.language,
    durationSeconds: row.duration_seconds === null ? null : Number(row.duration_seconds),
    syncedAt: new Date(row.synced_at).toISOString(),
  }
}

export function toRow(userId: string, entry: HistoryEntry) {
  return {
    user_id: userId,
    id: entry.id,
    text: entry.text,
    raw_text: entry.rawText ?? null,
    created_at: entry.createdAt,
    app: entry.app ?? null,
    topic: entry.topic ?? null,
    language: entry.language ?? null,
    duration_seconds: entry.durationSeconds ?? null,
    synced_at: new Date().toISOString(),
  }
}

const optionalString = (value: unknown, max: number) =>
  value === undefined || value === null || (typeof value === 'string' && value.length <= max)

/**
 * Why an entry cannot be stored, or null when it is fine. By default only phone
 * entries (ids starting with MOBILE_ID_PREFIX) are accepted, as for
 * /api/history/merge; /api/sync passes { mobileOnly: false } for the desktop's snapshot.
 */
export function invalidEntry(value: unknown, { mobileOnly = true }: { mobileOnly?: boolean } = {}): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'each entry must be an object'
  const e = value as Record<string, unknown>
  if (typeof e.id !== 'string' || !e.id.trim() || e.id.length > ID_MAX) return `"id" must be a non-empty string of at most ${ID_MAX} characters`
  if (mobileOnly && (!e.id.startsWith(MOBILE_ID_PREFIX) || e.id.length === MOBILE_ID_PREFIX.length)) return `"id" must start with "${MOBILE_ID_PREFIX}" (entries from the desktop cannot be changed here)`
  if (typeof e.text !== 'string' || e.text.length > TEXT_MAX) return `"text" must be a string of at most ${TEXT_MAX} characters`
  if (typeof e.createdAt !== 'string' || Number.isNaN(Date.parse(e.createdAt))) return '"createdAt" must be an ISO date string'
  if (!optionalString(e.rawText, TEXT_MAX)) return '"rawText" must be a string or null'
  for (const key of ['app', 'topic', 'language'] as const) {
    if (!optionalString(e[key], SHORT_MAX)) return `"${key}" must be a string of at most ${SHORT_MAX} characters, or null`
  }
  const d = e.durationSeconds
  if (!(d === undefined || d === null || (typeof d === 'number' && Number.isFinite(d) && d >= 0))) return '"durationSeconds" must be a non-negative number or null'
  return null
}
