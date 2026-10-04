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

## The rule: phone entries have ids starting with `mobile-`

Who owns an entry is decided by its id alone (the table has no "source" column):

| Id | Owner | Written by | Replaced or removed by |
|---|---|---|---|
| starts with `mobile-` (exactly, lowercase), e.g. `mobile-6f1c2a9e-…` | the mobile app | `POST /api/history/merge` only | only the mobile app, by merging the same id again |
| anything else | the desktop app | `POST /api/sync` | the next desktop sync |

- The mobile app gives **every** entry an id `mobile-<uuid>`. The merge route
  answers `400` for any other id, so the phone can never change a desktop entry.
- The desktop app must never use ids starting with `mobile-`.
- Merging an id that already exists **replaces** that phone entry.

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

Adds or updates the phone's entries by id. **Never deletes anything**: entries not
in the request, including all of the desktop's, stay as they are. Every id must
start with `mobile-`.

Request body: `{ "entries": HistoryEntry[] }` with 1 to 500 entries. If the same id
appears twice in one request, the last one is stored.

Response `200`: `{ "ok": true, "merged": 2 }` (`merged` = distinct ids stored).

Errors: `400` for bad input, with the first problem, e.g.
`{ "error": "entries[3]: \"id\" must start with \"mobile-\" (entries from the desktop cannot be changed here)" }`
or `{ "error": "entries[3]: \"createdAt\" must be an ISO date string" }`. Nothing is
stored when any entry is invalid. `401` without a valid token; `500` if the database
write failed.

## How the desktop sync works with phone entries

The desktop app syncs through `POST /api/sync`. For history it sends its whole
local list (its last 100 entries) every time. The server deletes the user's entries
**whose id does not start with `mobile-`** and stores the desktop's list in their
place. Entries from the phone are left untouched, so they survive every desktop sync
(tested in `tests/history-routes.test.ts`). An empty desktop list removes only the
desktop's entries.

The desktop app does not read the cloud history yet, so phone entries show up in
the mobile app (and in connected AI assistants), not in the desktop app's History.
