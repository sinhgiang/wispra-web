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

## Finding the buyer

Polar puts the buyer in `data.customer` (`email`, `external_id`); there is no `data.customer_email` in its
subscription payload (it is still read when `customer.email` is missing). The route tries, in order:

1. the account whose `subscriptions` row already holds this `polar_subscription_id`;
2. `customer.external_id`, when it is a Wispra user id (a checkout can pass it as `customer_external_id`);
3. the one account whose row already holds this `polar_customer_id` (a returning customer);
4. the buyer's email, matched without regard to case, paging through every account with
   `auth.admin.listUsers({ page, perPage: 1000 })` (up to 100 pages). `listUsers()` without a page returns only
   the first 50 accounts, so before T-0282 a buyer past those was never upgraded.

No account found: the event is recorded and changes nothing (the log names the subscription id, not the email).
A Supabase or auth error answers 500, so Polar retries.

## What each event does

| Event | Plan |
|---|---|
| `subscription.created`, `subscription.updated` | `pro` while the status is `active`, otherwise `free` |
| `subscription.canceled` | the same rule. A subscription canceled at the end of the period stays `active` until then, so the customer keeps Pro for the time already paid; `current_period_end` is saved |
| `subscription.revoked` | `free` at once: the period ended, it was canceled at once, or payment retries ran out |

Prices and plans are not changed here. An event that takes Pro away (revoked, or a status other than `active`)
applies only when it is about the subscription the account is linked to (`polar_subscription_id`), so the end of
an older subscription does not end the one still paid. Other event types are recorded and ignored.

Known gap: events are applied in the order they arrive. Polar retries failed deliveries, so an older event
delivered after a newer one would win.
