// What /api/transcribe sends to Groq and how many seconds it counts against the
// Free plan's monthly minutes. The seconds are measured on the server (T-0201, C2):
// a client that leaves out its own duration header no longer transcribes for free.

/** Groq speech-to-text models clients may ask for; anything else gets the default. */
export const TRANSCRIBE_MODELS = new Set(['whisper-large-v3-turbo', 'whisper-large-v3'])
export const DEFAULT_TRANSCRIBE_MODEL = 'whisper-large-v3-turbo'

export function allowedTranscribeModel(requested: unknown): string {
  return typeof requested === 'string' && TRANSCRIBE_MODELS.has(requested) ? requested : DEFAULT_TRANSCRIBE_MODEL
}

const ascii = (bytes: Uint8Array, at: number) => String.fromCharCode(...bytes.subarray(at, at + 4))

/**
 * Length in seconds of a PCM WAV file, from its header (byte rate and data size),
 * or null when the bytes are not a WAV file this can read. A data size larger than
 * the file (a header written before recording ended) counts the bytes present.
 */
export function wavDurationSeconds(bytes: Uint8Array): number | null {
  if (bytes.length < 12 || ascii(bytes, 0) !== 'RIFF' || ascii(bytes, 8) !== 'WAVE') return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let byteRate = 0
  let offset = 12
  while (offset + 8 <= bytes.length) {
    const id = ascii(bytes, offset)
    const size = view.getUint32(offset + 4, true)
    const body = offset + 8
    if (id === 'fmt ' && body + 12 <= bytes.length) byteRate = view.getUint32(body + 8, true)
    if (id === 'data') {
      if (!byteRate) return null
      const dataBytes = Math.min(size, bytes.length - body)
      return dataBytes / byteRate
    }
    offset = body + size + (size % 2)
  }
  return null
}

/**
 * Length in seconds Groq reports for its answer (verbose_json): the top-level
 * `duration` when there is one, else where the last segment ends. Null if neither.
 */
export function groqDurationSeconds(result: unknown): number | null {
  const r = result as { duration?: unknown; segments?: { end?: unknown }[] } | null
  const candidates: number[] = []
  if (typeof r?.duration === 'number') candidates.push(r.duration)
  if (Array.isArray(r?.segments)) {
    for (const s of r.segments) if (typeof s?.end === 'number') candidates.push(s.end)
  }
  const finite = candidates.filter(n => Number.isFinite(n) && n > 0)
  return finite.length ? Math.max(...finite) : null
}

/** Rough bytes per second of compressed speech audio (about 128 kbit/s), the last fallback. */
const COMPRESSED_BYTES_PER_SECOND = 16_000

/**
 * Seconds to count for one transcription, whole and at least 1. The server's own
 * measures win (the larger of Groq's and the WAV header's); the client's header is
 * used only when neither exists; failing that, the file size gives an estimate.
 */
export function billedSeconds(measure: {
  groq: number | null
  wav: number | null
  clientHeader: string | null
  fileBytes: number
}): number {
  const server = [measure.groq, measure.wav].filter((n): n is number => n !== null && Number.isFinite(n) && n > 0)
  let seconds: number
  if (server.length) {
    seconds = Math.max(...server)
  } else {
    const claimed = measure.clientHeader === null ? NaN : parseFloat(measure.clientHeader)
    seconds = Number.isFinite(claimed) && claimed > 0 ? claimed : measure.fileBytes / COMPRESSED_BYTES_PER_SECOND
  }
  return Math.max(1, Math.ceil(seconds))
}
