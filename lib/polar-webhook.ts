import { createHmac, timingSafeEqual } from 'node:crypto'

/** Polar retries for a while; anything signed further than this from now is refused (Standard Webhooks default). */
export const WEBHOOK_TOLERANCE_SECONDS = 5 * 60

export type WebhookCheck =
  | { ok: true; id: string }
  | { ok: false; reason: 'no-secret' | 'missing-headers' | 'bad-timestamp' | 'stale' | 'bad-signature' }

/**
 * Checks a Polar webhook the way Polar signs it: the Standard Webhooks scheme
 * (https://www.standardwebhooks.com, https://polar.sh/docs/integrate/webhooks/delivery).
 *
 * - Headers `webhook-id`, `webhook-timestamp` (Unix seconds) and `webhook-signature`
 *   (space-separated `v1,<base64>` entries; several during a secret rotation).
 * - The signature is HMAC-SHA256 over `<id>.<timestamp>.<raw body>`.
 * - The HMAC key is the secret's own UTF-8 bytes: Polar's SDK (`validateEvent`)
 *   base64-encodes the secret before handing it to the standardwebhooks library,
 *   which decodes it again.
 * - The timestamp must be within 5 minutes of now, so an old delivery that leaked
 *   cannot be sent again later.
 *
 * `body` must be the raw request text, byte for byte as received.
 */
export function verifyPolarWebhook(
  headers: Headers,
  body: string,
  secret: string | undefined,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): WebhookCheck {
  if (!secret) return { ok: false, reason: 'no-secret' }

  const id = headers.get('webhook-id')
  const timestamp = headers.get('webhook-timestamp')
  const signature = headers.get('webhook-signature')
  if (!id || !timestamp || !signature) return { ok: false, reason: 'missing-headers' }

  if (!/^\d{1,12}$/.test(timestamp)) return { ok: false, reason: 'bad-timestamp' }
  if (Math.abs(nowSeconds - Number(timestamp)) > WEBHOOK_TOLERANCE_SECONDS) return { ok: false, reason: 'stale' }

  const expected = createHmac('sha256', Buffer.from(secret, 'utf8')).update(`${id}.${timestamp}.${body}`).digest()
  for (const entry of signature.split(' ')) {
    const [version, value] = entry.split(',')
    if (version !== 'v1' || !value) continue
    const given = Buffer.from(value, 'base64')
    if (given.length === expected.length && timingSafeEqual(given, expected)) return { ok: true, id }
  }
  return { ok: false, reason: 'bad-signature' }
}
