// A guard for the language Whisper guesses (T-1059). The desktop app's language
// setting is "auto" by default, so it sends no `language` and Whisper guesses it
// from the audio. On a short or fast Vietnamese phrase it sometimes guesses a
// language nobody here speaks and writes the phrase in that one ("Nú nægði að það
// sáttíu." for "bạn kiểm tra cho tôi xem nó đã xong hay chưa", Icelandic). When the
// guess falls outside the languages the user dictates in, the audio is sent to Groq
// once more with the language fixed, and the better of the two answers is kept.

/** The languages assumed when the app does not say which ones the user dictates in. */
export const DEFAULT_LANGUAGES = ['vi', 'en'] as const

/** Names Whisper puts in verbose_json `language`, for the codes this guard can be asked for. */
const NAMES: Record<string, string> = {
  vi: 'vietnamese',
  en: 'english',
  fr: 'french',
  de: 'german',
  es: 'spanish',
  pt: 'portuguese',
  it: 'italian',
  ja: 'japanese',
  ko: 'korean',
  zh: 'chinese',
  th: 'thai',
  id: 'indonesian',
  ru: 'russian',
}

/** "vi", "Vietnamese", " VI " → "vi"; anything this guard has no name for stays as written, lower case. */
export function languageCode(value: unknown): string {
  if (typeof value !== 'string') return ''
  const text = value.trim().toLowerCase()
  for (const [code, name] of Object.entries(NAMES)) if (text === code || text === name) return code
  return text
}

/**
 * The languages the user dictates in: the optional `languages` field of the request
 * ("vi,en"; the first is the one they use most), else Vietnamese and English.
 * At most five codes of two or three letters, so the field cannot carry anything else.
 */
export function allowedLanguages(field: FormDataEntryValue | null): string[] {
  if (typeof field === 'string') {
    const codes = field
      .split(',')
      .map(languageCode)
      .filter(code => /^[a-z]{2,3}$/.test(code))
    const unique = [...new Set(codes)].slice(0, 5)
    if (unique.length > 0) return unique
  }
  return [...DEFAULT_LANGUAGES]
}

/**
 * Whether the answer's language is one nobody here speaks. An answer that names no
 * language (a stand-in server, an older model) is left alone.
 */
export function guessedOutsideSet(detected: unknown, allowed: string[]): boolean {
  const code = languageCode(detected)
  return code !== '' && !allowed.includes(code)
}

/** Mean `avg_logprob` of the segments with one, or null when there is none to read. */
export function meanConfidence(result: unknown): number | null {
  const segments = (result as { segments?: unknown } | null)?.segments
  if (!Array.isArray(segments)) return null
  const values = segments
    .map(s => (s as { avg_logprob?: unknown } | null)?.avg_logprob)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  if (values.length === 0) return null
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

/**
 * Whether to use the answer of the second try. Forcing a language on audio that
 * really is in another one (a French speaker) writes confident-looking nonsense with
 * LOWER confidence than Whisper's own guess; a wrong guess on Vietnamese speech
 * comes back with higher confidence once the language is right. When neither answer
 * carries a confidence, the second try wins: that is why it was made.
 */
export function preferSecondTry(first: unknown, second: unknown): boolean {
  const text = (second as { text?: unknown } | null)?.text
  if (typeof text !== 'string' || text.trim() === '') return false
  const a = meanConfidence(first)
  const b = meanConfidence(second)
  if (a === null || b === null) return true
  return b > a
}
