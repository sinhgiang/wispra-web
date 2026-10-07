// Meeting sessions the desktop app syncs through /api/sync (public.synced_meetings).

/** One meeting session as the desktop app sends it. */
export interface MeetingEntry {
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

/** Most sessions one /api/sync request may carry (it sends only changed ones). */
export const MEETINGS_SYNC_MAX = 200
const ID_MAX = 200
const TITLE_MAX = 1000
const SUMMARY_MAX = 200_000
const STATUS_MAX = 50
/** Characters of transcript, notes and language settings together, as JSON. */
const BODY_JSON_MAX = 3_000_000

const optionalString = (value: unknown, max: number) =>
  value === undefined || value === null || (typeof value === 'string' && value.length <= max)

/** Why a session cannot be stored, or null when it is fine. */
export function invalidMeeting(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'each meeting must be an object'
  const m = value as Record<string, unknown>
  if (typeof m.id !== 'string' || !m.id.trim() || m.id.length > ID_MAX) return `"id" must be a non-empty string of at most ${ID_MAX} characters`
  if (typeof m.createdAt !== 'string' || Number.isNaN(Date.parse(m.createdAt))) return '"createdAt" must be an ISO date string'
  if (!optionalString(m.title, TITLE_MAX)) return `"title" must be a string of at most ${TITLE_MAX} characters, or null`
  if (!optionalString(m.summary, SUMMARY_MAX)) return `"summary" must be a string of at most ${SUMMARY_MAX} characters, or null`
  if (!optionalString(m.status, STATUS_MAX)) return `"status" must be a short string, or null`
  if (!optionalString(m.spaceId, ID_MAX)) return `"spaceId" must be a string of at most ${ID_MAX} characters, or null`
  const d = m.durationMs
  if (!(d === undefined || d === null || (typeof d === 'number' && Number.isFinite(d) && d >= 0))) return '"durationMs" must be a non-negative number or null'
  const bodySize = JSON.stringify([m.segments ?? null, m.content ?? null, m.languageConfig ?? null]).length
  if (bodySize > BODY_JSON_MAX) return `"segments", "content" and "languageConfig" together are larger than ${BODY_JSON_MAX} characters`
  return null
}

export function toMeetingRow(userId: string, session: MeetingEntry) {
  return {
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
  }
}
