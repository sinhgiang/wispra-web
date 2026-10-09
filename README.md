<p align="center">
  <a href="https://wispra-web.vercel.app"><img src="app/icon.png" alt="Wispra" width="96" height="96"></a>
</p>

<h1 align="center">Wispra</h1>

<p align="center">
  <strong>Voice dictation for any app on your computer.</strong><br>
  Press one key, speak in any language, and your words are typed where your cursor is.
</p>

<p align="center">
  <a href="https://wispra-web.vercel.app"><strong>wispra-web.vercel.app</strong></a>
</p>

<p align="center">
  <a href="https://wispra-web.vercel.app">Website</a> ·
  <a href="https://github.com/sinhgiang/wispra-releases/releases/latest">Download</a> ·
  <a href="https://wispra-web.vercel.app/updates">Updates</a> ·
  <a href="https://github.com/sinhgiang/wispra-releases/issues">Support</a>
</p>

---

Wispra is a desktop app for Windows and macOS that turns speech into finished text. A global hotkey opens a
floating microphone over whatever you are working in; you speak, and Wispra transcribes, cleans up the text with
AI and types it into the active app: email, chat, a code editor, a document, a browser. It also records and
transcribes meetings, then turns them into summaries, mind maps, action items and posts.

This repository is **wispra-web**: the Wispra website and **Wispra Cloud**, the backend that lets a signed-in app
transcribe and use AI through Wispra's own server instead of a personal API key, with monthly limits per plan,
optional cloud sync, and a private link that connects AI assistants to your synced data.

**Get the app at [wispra-web.vercel.app](https://wispra-web.vercel.app)**: free to download.

## Table of contents

- [The problem](#the-problem)
- [How Wispra solves it](#how-wispra-solves-it)
- [Who it is for](#who-it-is-for)
- [Features](#features)
  - [Dictation in any app](#dictation-in-any-app)
  - [AI cleanup](#ai-cleanup)
  - [Meetings](#meetings)
  - [Learning your words](#learning-your-words)
  - [Wispra Cloud](#wispra-cloud)
  - [Cloud sync and AI assistants](#cloud-sync-and-ai-assistants)
  - [Privacy and data control](#privacy-and-data-control)
- [How it works, step by step](#how-it-works-step-by-step)
- [What this repository contains](#what-this-repository-contains)
- [Plans and limits](#plans-and-limits)
- [FAQ](#faq)
- [Tech stack](#tech-stack)
- [Repository](#repository)
- [Get started](#get-started)

## The problem

Most people speak at around 150 words per minute and type at around 40. A large share of the working day goes to
writing that is not hard, only slow: replies, status updates, meeting notes, tickets, comments.

Dictation should close that gap, but in practice it rarely does:

- **It lives in one place.** Built-in dictation works in some apps and not others, or needs a separate window, so
  the text has to be copied over.
- **Raw transcription is not finished text.** Fillers, missing punctuation and misheard names mean every dictation
  needs editing, which eats the time it saved.
- **Mixed languages break it.** People who switch between, say, Vietnamese and English in one sentence get poor
  results from tools tuned for one language.
- **Meetings are a separate problem.** A recording of an hour-long meeting is not useful until someone has
  summarised it, pulled out the decisions and written down who does what.

## How Wispra solves it

1. **One hotkey, everywhere.** Wispra works at the operating-system level. Press the hotkey in any app, speak, and
   the text is typed at the cursor. No window switching.
2. **Fast, multilingual transcription.** Speech is transcribed by Groq's hosted Whisper models, which handle 95+
   languages and detect the language automatically.
3. **AI cleanup before you see it.** A language model fixes punctuation and capitals, removes filler words and
   keeps names spelled the way you spell them, without summarising or dropping what you said.
4. **It learns from you.** Corrections you make become hints; recurring names and terms are picked up and used to
   hear you better next time.
5. **Meetings become documents.** A recorded meeting gets a transcript with topics, speakers and action items, a
   summary, a mind map and ready-to-edit posts, and you can ask questions about it.

## Who it is for

- **Professionals and managers** whose day is emails, meeting notes and chat replies, and who want to speak them
  instead of typing them.
- **Writers and content creators** who think faster than they type and want a clean first draft from speech.
- **Developers and power users** who want dictation in the editor, terminal or browser they are already in, from
  one hotkey.
- **People who work in more than one language**, including Vietnamese, with auto-detection and language-specific
  cleanup.
- **Teams that live in meetings** and want the transcript, summary and action items without writing them up.

## Features

### Dictation in any app

**Global hotkey and floating microphone.** `Ctrl + Shift + Space` by default, changeable in Settings. A small
microphone appears near the cursor while recording and shows when the text has been typed.

**Typed where you are.** The text is inserted into the active window at the cursor, including on multi-monitor
setups and into maximized windows.

**95+ languages, detected automatically.** Speak in one language or switch mid-sentence; a language can also be
pinned in Settings.

**Voice commands and snippets.** Say punctuation and formatting ("new paragraph", "comma"), expand your own
keyword snippets into longer text, or say "delete that" to undo the last dictation.

**History.** Every dictation is kept on your computer with its time, topic and app, filterable by day and by topic,
with a time-saved counter, AI summaries per topic, and export to TXT, Markdown or CSV.

**File transcription.** Drop an audio or video file into the Transcribe tab and get a transcript.

### AI cleanup

**Finished text, not raw transcription.** After transcription, an AI pass adds punctuation and capitals, removes
fillers and fixes obvious mishearings. It is instructed never to summarise or merge sentences, and if its result
is suspiciously short Wispra types your original words instead.

**Modes.** General, Professional, Vietnamese, Casual or your own instructions, switched from the tray menu. Wispra
can pick the tone from the app you are dictating into, such as email or chat.

### Meetings

**Record and transcribe.** Record a meeting from the microphone, the computer's audio, or both, and get a
transcript as it goes.

**Four-column transcript.** Time and speaker, topic, what was said, and action items side by side. Speakers are
labelled from names said in the recording ("I'm Linh") and can be renamed; in "Both" mode paragraphs are marked
You or Others. There is no voice recognition and nothing about anyone's voice is stored.

**Summary, mind map and posts.** A thorough summary with one section per topic; a clickable mind map that links
every point back to the transcript; and draft posts for a website, Facebook, Instagram, LinkedIn and X.

**Ask about the meeting.** A chat panel answers questions about the transcript and highlights the part the answer
came from.

### Learning your words

**Your words.** Fix a misheard word once and the AI cleanup gets a hint; fix it again and it is corrected
automatically. Every entry can be pinned, switched off or deleted.

**Suggestions and auto-learned vocabulary.** Wispra spots recurring names and terms in your History and meetings,
suggests them, and uses accepted terms to prime speech recognition.

**Writing style.** Habits taken from your own corrections, plus your notes, guide the cleanup. A private scorecard
shows whether learning is helping, and one switch turns it off.

### Wispra Cloud

Wispra works with your own Groq (or OpenAI) API key. **Wispra Cloud** is the alternative: sign in, and
transcription and AI text go through this repository's server with Wispra's key.

- **One switch in the app.** Settings → Account chooses between Wispra Cloud and your own key; switching never
  deletes a saved key.
- **Monthly limits per plan**, counted per account per calendar month: transcription minutes on the Free plan, and
  one shared AI allowance for cleanup, summaries, mind maps, posts and chat. See
  [Plans and limits](#plans-and-limits).
- **Clear answers when a limit is reached.** The server returns a distinct `ai_quota_exceeded` error with the limit,
  the amount used and the reset date, and the app shows it instead of failing. Dictation keeps working with the
  uncleaned transcript.
- **A request is never cut off half-way.** Limits are checked before each request; one that is admitted always
  finishes.

### Cloud sync and AI assistants

**Cloud sync (opt-in, off by default).** Keeps a copy of your dictation History, Meetings and learned words in your
Wispra account, updated a few seconds after something changes.

**Connect your AI assistant.** A private link lets ChatGPT, Claude, Grok, Perplexity, Cursor and other assistants
that support the Model Context Protocol read your synced data, read-only. The assistant can list, search and open
meetings, search dictation history, read your vocabulary and see usage statistics. The link can be given an expiry,
rotated or revoked at any time; only a hash of it is stored on the server.

### Privacy and data control

- **Your own key: straight to the provider.** With a personal API key, audio and text go from your computer to the
  AI provider directly and never pass through Wispra's server.
- **Wispra Cloud: passed through, not kept.** Audio and text sent through Wispra Cloud are forwarded to Groq and
  the result returned; the server stores only usage counts (seconds transcribed, AI tokens used).
- **Synced data only when you turn sync on.** Nothing from History or Meetings reaches the server unless cloud sync
  is enabled.
- **Per-account isolation.** Every table has row-level security; the server reads and writes on behalf of the
  signed-in user only.
- **Revocable assistant access.** Connection links are stored as hashes, can expire, and stop working the moment
  they are rotated or revoked.

## How it works, step by step

1. **Download Wispra** for Windows or macOS from the [latest release](https://github.com/sinhgiang/wispra-releases/releases/latest)
   and install it. The app updates itself when a new version is out.
2. **Choose how it runs.** Paste a free Groq API key into Settings, or sign in and choose Wispra Cloud.
3. **Press the hotkey** in any app and speak.
4. **Wispra transcribes** the audio with Groq: directly with your key, or through `/api/transcribe` on Wispra Cloud,
   which checks the plan's minutes first and counts the seconds afterwards.
5. **The AI cleanup runs**: directly with your key, or through `/api/chat/completions`, which checks the monthly AI
   allowance first and records the tokens Groq reports.
6. **The text is typed** at your cursor and saved to History on your computer.
7. **For meetings**, the transcript, topics, action items, summary and mind map are built with the same AI path, and
   stay with the recording.
8. **If cloud sync is on**, History, Meetings and learned words are copied to your account through `/api/sync`, and
   become readable by any AI assistant you have connected with your private link.

## What this repository contains

| Part | Path | What it does |
|---|---|---|
| Website | `app/page.tsx` | Landing page: features, who it is for, comparison, FAQ, download |
| Updates | `app/updates` | One page per desktop release with its notes and screenshot; new releases come from GitHub by themselves |
| Sign-in hand-off | `app/auth/callback`, `app/auth/relay` | Completes sign-in in the browser and hands the session back to the desktop app through the `wispra://` link |
| Transcription | `app/api/transcribe` | Forwards audio to Groq with the server key; enforces the Free plan's monthly minutes |
| AI text | `app/api/chat/completions` | Forwards chat completions to Groq with a whitelist of models; enforces the monthly AI allowance |
| Usage | `app/api/usage` | Plan, minutes and AI tokens used this month, limits and reset date, for the app's Account page |
| Cloud sync | `app/api/sync` | Receives the app's History, Meetings and learned words |
| AI assistant link | `app/api/mcp/token`, `app/api/mcp/[token]` | Creates, rotates and revokes the private link, and serves the read-only MCP endpoint behind it |
| Billing | `app/api/webhook/polar`, `lib/polar-webhook.ts` | Verifies Polar subscription webhooks (Standard Webhooks signature, 5-minute window), applies each delivery once (`webhook_events`, migration 011) and updates the account's plan |
| Database | `supabase/migrations` | Tables, row-level security and the functions that count usage |

The desktop app itself lives in a separate repository; its downloads and release notes are at
[github.com/sinhgiang/wispra-releases/releases](https://github.com/sinhgiang/wispra-releases/releases).

## Plans and limits

Using Wispra with your own API key has no Wispra limits: only your provider's own limits apply. The limits below
apply to **Wispra Cloud**, per account and per calendar month (UTC).

| | Free | Pro |
|---|---|---|
| Transcription through Wispra Cloud | 30 minutes per month | Unlimited |
| AI text through Wispra Cloud (cleanup, summaries, mind maps, posts, chat) | 300,000 tokens per month | 5,000,000 tokens per month |

Tokens count both what is sent to the AI and what it writes back, as reported by Groq. Pro is a subscription
handled by [Polar](https://polar.sh). Both limits are set in one place in the code (`lib/ai-quota.ts` and
`app/api/transcribe`).

## FAQ

**Do I need an account?**
No. With your own Groq API key, Wispra works without an account. An account is needed only for Wispra Cloud and
cloud sync.

**Is Wispra free?**
Yes, the app is free to download and use with your own API key. Groq offers a free tier. Wispra Cloud has a Free
plan with monthly limits and a paid Pro plan.

**Which languages does it understand?**
95+ languages through Groq's Whisper models, detected automatically. The AI cleanup has dedicated handling for
Vietnamese.

**Which apps does it work in?**
Any app with a text field: Gmail, Slack, VS Code, Word, Notion, a browser, a terminal, on Windows and macOS.

**Is my audio stored?**
Not by Wispra. With your own key, audio goes straight to the provider. Through Wispra Cloud, it is forwarded to
Groq and not kept on Wispra's server. Dictation history is stored on your computer, and in your account only if you
turn on cloud sync.

**What happens when the monthly AI allowance runs out?**
The app says so, with the amount used and the reset date. Dictation keeps typing your words, without the AI
cleanup, and nothing you said is lost. The allowance resets on the 1st of the next month.

**Can an AI assistant change my data?**
No. The assistant link is read-only, and you can revoke it at any time.

**Is the app signed?**
The Windows installer is not code-signed yet, so Windows SmartScreen may show a warning on first install: choose
"More info", then "Run anyway".

More questions are answered on [the website](https://wispra-web.vercel.app), or open an
[issue](https://github.com/sinhgiang/wispra-releases/issues).

## Tech stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router), React 19, TypeScript |
| UI | Tailwind CSS 3 |
| Database and auth | Supabase (Postgres with row-level security, Supabase Auth) |
| Speech and AI | Groq: Whisper for transcription, `openai/gpt-oss-120b` by default for AI text |
| AI assistant link | Model Context Protocol (`@modelcontextprotocol/sdk`, `mcp-handler`) |
| Billing | Polar (webhooks) |
| Hosting | Vercel |
| Tests | Vitest, with PGlite running the real migrations in an in-memory Postgres |

The desktop app is built with Electron, React and TypeScript.

## Repository

This repository holds the website and the Wispra Cloud backend. It does not include an open-source licence; the
code belongs to the owner of Wispra.

For development: `npm install`, copy `.env.example` to `.env.local` and fill in your own Supabase, Groq and Polar
values, then `npm run dev`. `npm test` runs the test suite, and `npm run build` checks a production build. The
production database differs from `supabase/migrations/001_initial.sql` in places; read
[supabase/PRODUCTION_DRIFT.md](supabase/PRODUCTION_DRIFT.md) before writing a migration.

### New releases on the Updates page

[wispra-web.vercel.app/updates](https://wispra-web.vercel.app/updates) reads the releases of
[`sinhgiang/wispra-releases`](https://github.com/sinhgiang/wispra-releases/releases) from GitHub and re-checks them every hour. A
new version therefore appears there **without any change to this repository and without a deploy**, as long as
the release is published like this (the desktop app's release process does it on every release):

1. **Release notes for users**, in Markdown: an optional one-line summary, then `## New`, `## Improved` and
   `## Fixed` with `- ` bullets, each starting with a short **bold lead**.
2. **A headline in the release title**: `v0.6.6 — Mind maps you can edit`.
3. **A screenshot attached as `screenshot.png`**: 1600 × 1000, dark mode, showing what changed, with
   **sample content only** (no real names, recordings, email addresses or file paths):
   `gh release upload v0.6.6 screenshot.png -R sinhgiang/wispra-releases`.
4. **Published** (not a draft or pre-release), with a tag like `v0.6.6`.

The release is on the page, marked Latest, within an hour. Versions 0.1.0 to 0.6.5 are kept in this repository
with hand-written text and images, and those entries take precedence over GitHub's. Details, and how to rewrite
an entry here: [docs/UPDATES.md](docs/UPDATES.md).

## Get started

Wispra is live at **[wispra-web.vercel.app](https://wispra-web.vercel.app)**.

- See what it does: [wispra-web.vercel.app](https://wispra-web.vercel.app)
- Download the latest version: [github.com/sinhgiang/wispra-releases/releases/latest](https://github.com/sinhgiang/wispra-releases/releases/latest)
- Read what changed in each version: [wispra-web.vercel.app/updates](https://wispra-web.vercel.app/updates)
- Report a problem or ask a question: [issues](https://github.com/sinhgiang/wispra-releases/issues)
