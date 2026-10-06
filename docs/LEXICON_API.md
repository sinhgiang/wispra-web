# /api/lexicon — Custom Vocabulary and Learned words per account

Step 1 of syncing the two lists between the desktop and phone apps. The server
only stores and returns them; the apps merge (step 2: desktop, step 3: phone).

Both routes need `Authorization: Bearer <Supabase access token>`, like the other
`/api/*` routes, and only ever touch the rows of that token's user. Nothing in
the request (a `userId` in the body, a lexicon id another user also has) can
reach another account.

## GET /api/lexicon

```json
{
  "vocabulary": { "terms": ["Github", "Capcut", "TikTok"], "updatedAt": "2026-10-07T01:00:00.000Z" },
  "lexicon": [
    {
      "id": "w1", "term": "Lenvid", "heardAs": ["lenvit"], "count": 2,
      "enabled": true, "pinned": false, "source": "fix",
      "createdAt": "2026-10-06T08:00:00.000Z", "lastSeen": "2026-10-06T09:00:00.000Z",
      "syncedAt": "2026-10-07T01:00:00.000Z"
    }
  ]
}
```

- A new account gets `{ "terms": [], "updatedAt": null }` and `[]`.
- `lexicon` holds every learned word (read in pages, so more than 1,000 is fine),
  sorted by `id`. Entries have the shape the desktop sends to `/api/sync`.

## PUT /api/lexicon

```json
{ "vocabulary": ["Github", "TikTok"], "lexicon": [ { "id": "w1", "term": "Lenvid", ... } ] }
```

- Each list that is present **replaces** the stored one; a list that is left out
  is not touched. Send the list already merged with what GET returned.
- `vocabulary`: strings of at most 200 characters, at most 2,000 terms. Terms are
  trimmed; empty ones and exact duplicates are dropped; the order is kept.
- `lexicon`: at most 2,000 entries. `id` and `term` are required; `count` a
  number, `enabled`/`pinned` booleans, `createdAt`/`lastSeen` ISO dates (all may
  be null). The same `id` twice: the last one is stored.
- Everything is checked before anything is written: one bad entry gives `400`
  and changes nothing.
- The new learned words are written first and the ones no longer in the list
  removed after, so a failure part way keeps the old words.
- Answer: `{ "ok": true, "vocabulary": <terms stored>, "lexicon": <entries stored> }`.

| Status | Meaning |
|---|---|
| 401 | No token, or an invalid or expired one |
| 400 | Bad JSON, neither list sent, or a list that breaks the rules above |
| 503 | `vocabulary` sent but migration 009 is not applied yet |
| 500 | The database refused a read or write |

## Storage

- Custom Vocabulary: `public.synced_vocabulary` (migration
  `009_synced_vocabulary.sql`), one row per user, `terms text[]`.
- Learned words: the existing `public.synced_lexicon` (migration 002).

Both have RLS on and no policies: only the server (service role) reads them.
Before migration 009 is applied, GET returns an empty vocabulary.

## Until step 2

The desktop still sends its whole lexicon through `/api/sync`, which replaces
the stored list. Learned words a phone writes through `PUT /api/lexicon` can be
overwritten by the next desktop sync until the desktop reads and merges through
`GET /api/lexicon` first.

## Checking a deployment with real sign-ins

`node scripts/probe-lexicon.mjs <deployment URL>` signs in one or two **test**
accounts (it asks for them and the Supabase publishable key, and prints none of
them), then checks 401s, PUT and GET on the real tables, that account 2 cannot
see or change account 1's lists, and puts every list back as it was. Protected
previews go through `vercel curl`.
