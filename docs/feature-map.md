# Feature map

## Features

- Landing page: `app/page.tsx`; the user gets there at `/`.
- Updates (release notes per desktop version): `app/updates`, `lib/wispra-releases.ts`, `lib/latest-release.ts`; at `/updates` and `/updates/<version>`.
- Sign-in hand-off to the desktop app: `app/auth/callback`, `app/auth/relay`; opened by the desktop app's sign-in, ends in a `wispra://` link.
- Transcription: `app/api/transcribe`, `lib/transcription.ts`; called by the desktop/phone app with the user's Supabase token.
- AI text: `app/api/chat/completions`, `lib/ai-quota.ts`; called by the apps.
- Usage and plan: `app/api/usage`, `lib/account.ts`; the app's Account page.
- Cloud sync (History, Meetings, learned words): `app/api/sync`, `app/api/history*`, `app/api/lexicon`, `lib/history*.ts`, `lib/meetings.ts`, `lib/lexicon.ts`; called by the apps.
- AI assistant link (remote MCP): `app/api/mcp/token` (create/rotate/revoke the link), `app/api/mcp/[token]` (the MCP endpoint, `mcp-handler` 2.x), `lib/mcp/`; the user copies the link from the app's Connections page into ChatGPT, Claude.ai, Grok.
- Billing: `app/api/webhook/polar`; called by Polar.
- Database: `supabase/migrations` (tables, RLS, usage functions); production drift in `supabase/PRODUCTION_DRIFT.md`.

## Run and check

- Open it: `npm install`, then `npm run dev` and open http://localhost:3000. The API routes need the keys in `.env.local` (names in `.env.example`); never print them. A pushed branch also gets a Vercel preview at `https://wispra-web-*.vercel.app`.
- Test account: none recorded. The automated tests (`npm test`) run every API route against the real migrations in PGlite with made-up users, so no real login is needed for them. A remote-MCP check by hand needs a link made from a throwaway account in the app.
- Main flow to go through: open `/`, open `/updates` and one version page; for the MCP endpoint, a POST `tools/list` to `/api/mcp/<link>` answers the 7 tools, and an unknown link answers 403.
- Screenshot: the Helme browser (mcp__helme-browser__take_screenshot) on localhost or the branch's Vercel preview.
