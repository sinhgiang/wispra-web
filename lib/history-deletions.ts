// Deleted history entries ("tombstones", table public.synced_history_deletions,
// migration 008). A deletion on one device must reach every device of the account:
// the deleted ids are kept here, returned by GET /api/history, and skipped by
// /api/sync and /api/history/merge so no device can bring a deleted entry back.

import type { SupabaseClient } from '@supabase/supabase-js'

/** The id that records "delete everything": its deleted_at is the last clear. */
export const CLEAR_ALL_ID = '*'

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

const NONE: Deletions = { entries: [], ids: new Set(), clearedAt: null }

/**
 * Every deletion of one user. Fails open: if the table cannot be read (database
 * error, or migration 008 not applied yet) nothing counts as deleted and the error
 * is logged, so reading and syncing history keep working.
 */
export async function getDeletions(supabase: SupabaseClient, userId: string): Promise<Deletions> {
  const { data, error } = await supabase
    .from('synced_history_deletions')
    .select('id, deleted_at')
    .eq('user_id', userId)
  if (error) {
    console.error('[history] could not read synced_history_deletions, treating nothing as deleted:', error.message)
    return NONE
  }
  const entries: Deletion[] = []
  let clearedAt: string | null = null
  for (const row of (data ?? []) as { id: string; deleted_at: string }[]) {
    const deletedAt = new Date(row.deleted_at).toISOString()
    if (row.id === CLEAR_ALL_ID) clearedAt = deletedAt
    else entries.push({ id: row.id, deletedAt })
  }
  entries.sort((a, b) => a.deletedAt.localeCompare(b.deletedAt) || a.id.localeCompare(b.id))
  return { entries, ids: new Set(entries.map(e => e.id)), clearedAt }
}

/** True when the entry was deleted, or was created at or before the last "delete everything". */
export function isDeleted(entry: { id: string; createdAt: string }, deletions: Deletions): boolean {
  if (deletions.ids.has(entry.id)) return true
  if (!deletions.clearedAt) return false
  const created = Date.parse(entry.createdAt)
  return Number.isFinite(created) && created <= Date.parse(deletions.clearedAt)
}

/** Records that `id` (or CLEAR_ALL_ID) was deleted at `at`; a later deletion of the same id moves the time. */
export async function recordDeletion(supabase: SupabaseClient, userId: string, id: string, at: string) {
  return supabase
    .from('synced_history_deletions')
    .upsert({ user_id: userId, id, deleted_at: at }, { onConflict: 'user_id,id' })
}
