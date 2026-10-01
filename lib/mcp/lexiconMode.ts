import type { LexiconRow } from './types'

/** Hand-synced port of spetotext's src/shared/lexiconMode.ts, adapted to read a synced_lexicon row. */

const LEXICON_REPLACE_MIN_COUNT = 2

export type LexiconMode = 'replace' | 'hint' | 'spelling' | 'off'

export function lexiconMode(e: LexiconRow): LexiconMode {
  if (e.enabled === false) return 'off'
  if (!e.heard_as || e.heard_as.length === 0) return 'spelling'
  return e.source === 'manual' || e.pinned === true || (e.count ?? 0) >= LEXICON_REPLACE_MIN_COUNT ? 'replace' : 'hint'
}
