# Updates page: adding a release

The page at `/updates` (linked as **Updates** in the site footer) lists every Wispra
desktop release with what changed and one screenshot. It is built from two things
in this repo:

| What | Where |
|---|---|
| The text of each release | `app/updates/releases.ts`, the `RELEASES` list |
| The screenshot of each release | `public/updates/<version>.webp` |

The newest entry is shown as **Latest** and opens at `/updates`; every other version
has its own page at `/updates/<version>` (for example `/updates/0.6.4`). The pages
are generated at build time, so nothing is fetched from GitHub when someone visits.

## Steps for a new release

1. **Write the entry.** Add an object at the **top** of `RELEASES` in
   `app/updates/releases.ts`:

   ```ts
   {
     version: '0.6.6',            // no "v"
     date: '2026-10-10',          // release day, YYYY-MM-DD
     title: 'One short headline',
     summary: 'Optional: one or two sentences.',
     new: ['…'],                  // any of new / improved / fixed; leave out empty ones
     improved: ['…'],
     fixed: ['…'],
     imageAlt: 'What the screenshot shows, for screen readers.',
   },
   ```

   Start from the GitHub release notes (`gh release view v0.6.6 -R sinhgiang/wispra`)
   and rewrite them for people who use the app: plain English, what they will
   notice, no model names, file names or internal details unless they matter to
   the user. One idea per bullet.

2. **Add the screenshot** as `public/updates/0.6.6.webp`:
   - 1600 × 1000 pixels (16:10), WebP, under about 250 KB. The page shows it at
     that ratio, so other sizes look stretched or letterboxed.
   - Show the change that release brought, in dark mode, with the app's version
     visible if the screen shows one.
   - **Sample content only:** invented meeting titles and text, fake emails such as
     `alex@example.com`, masked keys (`gsk_••••3f9a`). No real names, recordings,
     email addresses, Windows user names or file paths. This repo and the site are
     public.
   - To convert a PNG: `node -e "require('sharp')('in.png').resize(1600,1000).webp({quality:82}).toFile('public/updates/0.6.6.webp')"`
     (`sharp` is already installed with Next.js).

3. **Check:** `npm test` (fails if the entry is out of order, has no changes, or its
   image is missing or too large), then `npm run dev` and open
   http://localhost:3000/updates on a desktop width and a phone width.

4. Commit both files together, push the branch, and look at the Vercel preview
   before merging.

## Screenshots of 0.1.0 – 0.6.5

The first 28 screenshots were made after the fact, not captured from the running
app. Each screen was rebuilt as a static page from that version's own stylesheet
and markup (taken from the app repository at the version's tag), or from the app's
two design prototypes for the mind map and four-column transcript, then rendered
with headless Chrome. Window frames, the Windows desktop, notifications and the
sample apps being dictated into were drawn by hand, and some images have a soft
ring around the setting that changed. All text is invented sample content.

From 0.6.6 on, prefer a real screenshot of the app with sample data.
