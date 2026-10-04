# History API (for the desktop and mobile apps)

These routes let the Wispra apps share the dictation history kept in Wispra Cloud
(table `public.synced_history`, deletions in `public.synced_history_deletions`).
Base URL: `https://wispra-web.vercel.app`.

| Route | What it does |
|---|---|
| `GET /api/history` | Read the history, plus what was deleted since you last asked |
| `POST /api/history/merge` | Add or update the phone's entries (ids `mobile-…`) |
| `DELETE /api/history/{id}` | Delete one entry, on every device |
| `DELETE /api/history` with `{ "all": true }` | Delete the whole history, on every device |
| `POST /api/sync` | The desktop app's sync (whole local list) |

All of them need the user's Supabase session token, the same one the desktop app
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
| `since` | none | ISO date: `deleted` lists only ids deleted at or after it. Pass the previous answer's `serverTime`. Without it, `deleted` lists every deletion |

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
  "nextBefore": "2026-10-05T08:11:00.000Z",
  "deleted": [
    { "id": "desk-1728111111", "deletedAt": "2026-10-05T12:05:00.000Z" }
  ],
  "clearedAt": null,
  "serverTime": "2026-10-05T12:06:00.000Z"
}
```

- `nextBefore` is `null` on the last page. `syncedAt` is when the server last stored
  the entry.
- `deleted`: entries deleted on any device of this account (see "Deleting" below),
  oldest first. Delete these ids on this device too.
- `clearedAt`: when the whole history was last deleted, or `null`. Delete every
  local entry created at or before it.
- `serverTime`: keep it and send it as `since` next time.

Errors: `400` for a bad `limit`, `before` or `since`, `401` without a valid token.

Known limit: entries that share exactly the same `createdAt` as the last entry of
a page may be skipped on the next page.

## POST /api/history/merge

Adds or updates the phone's entries by id. **Never deletes anything**: entries not
in the request, including all of the desktop's, stay as they are. Every id must
start with `mobile-`.

Request body: `{ "entries": HistoryEntry[] }` with 1 to 500 entries. If the same id
appears twice in one request, the last one is stored.

Response `200`: `{ "ok": true, "merged": 2 }` (`merged` = distinct ids stored). Entries
that were deleted on some device, or created at or before the last "delete
everything", are not stored; they are counted in `"skippedDeleted": 1` (only
present when not zero).

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

Deleted entries are left out of what the desktop sends (see below): the answer is
`{ "ok": true, "synced": { "history": <stored>, … }, "historySkipped": <n> }`,
`historySkipped` only when not zero.

The desktop app does not read the cloud history yet, so phone entries show up in
the mobile app (and in connected AI assistants), not in the desktop app's History.

## Deleting

A deletion on one device removes the entry on every device of the account. The
server keeps a mark for each deleted id (ids and times only, never the text), so:

1. the other devices learn of it from `deleted` / `clearedAt` in `GET /api/history`;
2. a device that has not heard of it yet cannot bring it back: `POST /api/sync`
   and `POST /api/history/merge` skip deleted ids, and entries created at or
   before the last "delete everything".

A deleted id stays deleted: do not reuse ids.

### DELETE /api/history/{id}

Deletes one entry, desktop or phone (any id), of the signed-in user. Put the id in
the path, URL-encoded. No body.

Response `200`: `{ "ok": true, "deleted": 1 }`. `deleted` is `0` when the entry was
not in the cloud; the deletion is recorded anyway, so a device that still has it
cannot sync it back. Errors: `400` for an empty, too long (over 200 characters) or
`*` id; `401`; `500` if the deletion could not be recorded (then nothing was
deleted).

### DELETE /api/history

Deletes the signed-in user's whole history, desktop and phone. The body must be
exactly `{ "all": true }`; anything else gets `400`, so a stray request cannot wipe
the history.

Response `200`: `{ "ok": true, "deleted": 42, "clearedAt": "2026-10-05T12:30:00.000Z" }`.
Every device then deletes its local entries created at or before `clearedAt`.
Errors: `400`, `401`, `500` as above.

### What each app does

- **Before deleting, ask the user plainly**, for example "Delete this entry from
  every device signed in to this account?" or "Delete your whole history on every
  device? This cannot be undone." After deleting, say what happened ("1 entry
  deleted", "42 entries deleted").
- Call the delete route; when it answers `200`, delete the entry (or everything)
  locally.
- Each time history is read, send `since` = the last `serverTime`; delete locally
  every id in `deleted`, and, if `clearedAt` is newer than the last one handled,
  every local entry created at or before it.
- An app that keeps a local copy and syncs it (the desktop) should do this before
  its next sync. If it does not, the deleted entries are simply skipped by the
  server, but they stay on that device.
