// Deleted history entries ("tombstones", table public.synced_history_deletions,
// migration 008). A deletion on one device must reach every device of the account:
// the deleted ids are kept here, returned by GET /api/history, and skipped by
// /api/sync and /api/history/merge so no device can bring a deleted entry back.

import type { SupabaseClient } from '@supabase/supabase-js'

/** The id that records "delete everything": its deleted_at is the last clear. */
export const CLEAR_ALL_ID = '*'

/**
 * How much earlier than a "delete everything" an entry must have been created to
 * be dropped by time alone. Entries that were in the cloud at the clear are
 * dropped by their own id, whatever their time; this margin only applies to
 * entries the server never saw. It keeps a new dictation from a device whose
 * clock runs a few minutes behind the server from being thrown away.
 */
export const CLEAR_CUTOFF_MARGIN_MS = 5 * 60_000

export interface Deletion {
  id: string
  deletedAt: string
}

export interface Deletions {
  /** Ids deleted one by one (never '*'), with when. */
  entries: Deletion[]
  ids: Set<string>
  /** When the whole history was last deleted, or null. */
  clearedAt: string | null
}

export type DeletionsResult = { ok: true; deletions: Deletions } | { ok: false; error: string }

const NONE: Deletions = { entries: [], ids: new Set(), clearedAt: null }

/** "The table does not exist": Postgres 42P01, or PostgREST's PGRST205 (not in its schema cache). */
export function isMissingTable(error: { code?: string; message?: string }): boolean {
  return error.code === '42P01' || error.code === 'PGRST205'
}

/**
 * Every deletion of one user.
 *
 * Only when the table does not exist (migration 008 not applied yet) does this
 * count as "nothing deleted", so history keeps working before the migration. Any
 * other error is returned as a failure: callers must then stop without writing,
 * because writing history without knowing what was deleted could bring deleted
 * entries back.
 */
export async function getDeletions(supabase: SupabaseClient, userId: string): Promise<DeletionsResult> {
  const { data, error } = await supabase
    .from('synced_history_deletions')
    .select('id, deleted_at')
    .eq('user_id', userId)
  if (error) {
    if (isMissingTable(error)) {
      console.error('[history] synced_history_deletions does not exist (migration 008 not applied); treating nothing as deleted')
      return { ok: true, deletions: NONE }
    }
    console.error('[history] could not read synced_history_deletions:', error.message)
    return { ok: false, error: error.message }
  }
  const entries: Deletion[] = []
  let clearedAt: string | null = null
  for (const row of (data ?? []) as { id: string; deleted_at: string }[]) {
    const deletedAt = new Date(row.deleted_at).toISOString()
    if (row.id === CLEAR_ALL_ID) clearedAt = deletedAt
    else entries.push({ id: row.id, deletedAt })
  }
  entries.sort((a, b) => a.deletedAt.localeCompare(b.deletedAt) || a.id.localeCompare(b.id))
  return { ok: true, deletions: { entries, ids: new Set(entries.map(e => e.id)), clearedAt } }
}

/**
 * True when the entry was deleted by id, or (for an entry the server never saw)
 * was created more than CLEAR_CUTOFF_MARGIN_MS before the last "delete everything".
 */
export function isDeleted(entry: { id: string; createdAt: string }, deletions: Deletions): boolean {
  if (deletions.ids.has(entry.id)) return true
  if (!deletions.clearedAt) return false
  const created = Date.parse(entry.createdAt)
  return Number.isFinite(created) && created <= Date.parse(deletions.clearedAt) - CLEAR_CUTOFF_MARGIN_MS
}

/**
 * Records that each of `ids` (or CLEAR_ALL_ID) was deleted at `at`; a later
 * deletion of the same id moves the time.
 */
export async function recordDeletions(supabase: SupabaseClient, userId: string, ids: string[], at: string) {
  return supabase
    .from('synced_history_deletions')
    .upsert(ids.map(id => ({ user_id: userId, id, deleted_at: at })), { onConflict: 'user_id,id' })
}
