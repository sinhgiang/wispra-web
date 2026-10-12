# Polar webhook

`POST /api/webhook/polar` receives Polar's subscription events and sets the account's plan in `subscriptions`.

## Signature

Polar signs every delivery with the [Standard Webhooks](https://www.standardwebhooks.com) scheme
([Polar docs](https://polar.sh/docs/integrate/webhooks/delivery)). `lib/polar-webhook.ts` checks it:

- headers `webhook-id`, `webhook-timestamp` (Unix seconds) and `webhook-signature` (`v1,<base64>`, several
  separated by spaces while a secret is rotated);
- HMAC-SHA256 over `<webhook-id>.<webhook-timestamp>.<raw body>`, keyed with the bytes of `POLAR_WEBHOOK_SECRET`
  exactly as Polar shows it (what `validateEvent` of `@polar-sh/sdk` does);
- the timestamp must be within 5 minutes of the server's clock.

Anything else answers `401 Invalid signature` and changes nothing. So does a missing `POLAR_WEBHOOK_SECRET`.
The reason (`missing-headers`, `stale`, `bad-signature`, ...) goes to the server log only.

## Each delivery once

Polar resends a delivery with the same `webhook-id` until it gets a 2xx. Before applying an event the route
inserts the id into `webhook_events` (migration `011_webhook_events.sql`, RLS on, no policy: server only):

- id already there: answers `200 { ok: true, duplicate: true }` and does nothing;
- applying fails (Supabase error): the id is removed again and the route answers 500, so Polar's retry is applied;
- table missing (migration 011 not applied yet): the event is applied without the record; the 5-minute window
  still refuses old deliveries.

## Checking after a deploy

In Polar: Settings → Webhooks → the endpoint `https://wispra-web.vercel.app/api/webhook/polar` → a past delivery
→ Redeliver (or send a test event). The delivery log should show `200`. The same delivery sent again answers
`{"ok":true,"duplicate":true}`. A `401` means the endpoint's secret in Polar differs from `POLAR_WEBHOOK_SECRET`
on Vercel.

## Not changed here

What an event does to the plan is as before: `subscription.created` / `subscription.updated` set `pro` when the
status is `active`, otherwise `free`; `subscription.canceled` sets `free`. Known gaps, left for a separate change:

- the buyer is found by email through `auth.admin.listUsers()`, which returns only the first 50 accounts;
- `subscription.canceled` downgrades at once, although the customer keeps access to the end of the period;
  `subscription.revoked` is not handled.
