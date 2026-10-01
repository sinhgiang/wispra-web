/**
 * Shapes of the synced_* Supabase rows this server reads, matching the columns written by
 * app/api/sync/route.ts. Mirrors the relevant slices of spetotext's src/shared/types.ts and
 * mcp-server/src/types.ts — kept in sync by hand, same precedent those two already set for
 * reading this data outside the Electron main process.
 */

export interface HistoryRow {
  id: string
  text: string
  raw_text: string | null
  created_at: string
  app: string | null
  topic: string | null
  language: string | null
  duration_seconds: number | null
}

export interface MeetingSegment {
  id: string
  text: string
  startMs: number
  endMs: number
  startedAt: string
  isNewParagraph: boolean
  topicLabel?: string
}

export interface MeetingRow {
  id: string
  title: string | null
  summary: string | null
  created_at: string
  duration_ms: number | null
  status: string | null
  segments: MeetingSegment[] | null
}

export interface LexiconRow {
  id: string
  term: string
  heard_as: string[] | null
  count: number | null
  enabled: boolean | null
  pinned: boolean | null
  source: string | null
  last_seen: string | null
}

export interface UsageStats {
  totalDictations: number
  totalMinutes: number
  totalWords: number
  thisWeekDictations: number
  thisWeekMinutes: number
  streak: number
  mostActiveDay: string
}
