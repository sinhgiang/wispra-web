# History API (for the mobile app)

Two routes let the Wispra mobile app share the dictation history the desktop app
syncs to Wispra Cloud (table `public.synced_history`). Base URL:
`https://wispra-web.vercel.app`.

Both routes need the user's Supabase session token, the same one the desktop app
sends: `Authorization: Bearer <access_token>`. A missing, expired or invalid token
gets `401`. The user is always the one the token belongs to: nothing in the URL or
body can point at another user's history.

## The entry shape

The same shape the desktop app sends to `/api/sync`:

```ts
interface HistoryEntry {
  id: string                  // required, 1-200 characters, unique per user
  text: string                // required, the text that was typed, up to 100,000 characters
  rawText?: string | null     // the transcript before AI cleanup
  createdAt: string           // required, ISO 8601, e.g. "2026-10-05T08:10:00.000Z"
  app?: string | null         // app dictated into, up to 200 characters
  topic?: string | null       // up to 200 characters
  language?: string | null    // e.g. "en", "vi"; up to 200 characters
  durationSeconds?: number | null  // >= 0
}
```

Ids are chosen by the apps. Use ids that cannot collide with the desktop's, for
example a `mobile-` prefix plus a UUID. An entry sent with an id that already
exists **replaces** that entry.

## GET /api/history

The signed-in user's history, newest first (by `createdAt`).

Query parameters:

| Name | Default | Meaning |
|---|---|---|
| `limit` | 100 | Entries per page, 1 to 500 |
| `before` | none | ISO date: only entries created before it. Pass the previous page's `nextBefore` to get the next (older) page |

Response `200`:

```json
{
  "entries": [
    {
      "id": "mobile-6f1c…",
      "text": "Call the supplier about the invoice.",
      "rawText": "call the supplier about the invoice",
      "createdAt": "2026-10-05T08:11:00.000Z",
      "app": "Notes",
      "topic": "Tasks",
      "language": "en",
      "durationSeconds": 4.5,
      "syncedAt": "2026-10-05T08:11:02.120Z"
    }
  ],
  "nextBefore": "2026-10-05T08:11:00.000Z"
}
```

`nextBefore` is `null` on the last page. `syncedAt` is when the server last stored
the entry. Errors: `400` for a bad `limit` or `before`, `401` without a valid token.

Known limit: entries that share exactly the same `createdAt` as the last entry of
a page may be skipped on the next page.

## POST /api/history/merge

Adds or updates entries by id. **Never deletes anything**: entries not in the
request, including all of the desktop's, stay as they are.

Request body: `{ "entries": HistoryEntry[] }` with 1 to 500 entries. If the same id
appears twice in one request, the last one is stored.

Response `200`: `{ "ok": true, "merged": 2 }` (`merged` = distinct ids stored).

Errors: `400` with `{ "error": "entries[3]: \"createdAt\" must be an ISO date string" }`
for bad input (nothing is stored when any entry is invalid); `401` without a valid
token; `500` if the database write failed.

## Important: the desktop app still replaces the whole list

The desktop app syncs through `POST /api/sync`, which deletes the user's whole
history in the cloud and stores the desktop's local list (its last 100 entries)
in its place. That route is unchanged. Until it changes, **entries merged from the
phone are removed the next time the desktop syncs** (covered by a test in
`tests/history-routes.test.ts`). The mobile app should keep its own entries locally
and not treat the cloud as the only copy yet.
