# Updates page

The page at `/updates` (linked as **Updates** in the site footer) lists every Wispra
desktop release with what changed and one screenshot. The newest version is shown
as **Latest** and opens at `/updates`; every other version has its own page at
`/updates/<version>` (for example `/updates/0.6.4`).

## Where the entries come from

| Source | What | Used for |
|---|---|---|
| GitHub releases of [`sinhgiang/wispra-releases`](https://github.com/sinhgiang/wispra-releases/releases) | The release notes, and an asset named `screenshot.png` | Every release that is **not** kept in this repo, in particular each new one |
| `app/updates/releases.ts` + `public/updates/<version>.webp` | Hand-written text and image | 0.1.0 to 0.6.5, and any later release someone chooses to rewrite here |

The site re-reads the GitHub releases at most **once an hour** (`revalidate = 3600`).
A new release therefore appears on `/updates` within an hour of being published,
**without any change to this repository and without a deploy**. If a version
exists in both places, the entry in `releases.ts` wins. If GitHub cannot be
reached (or rate-limits the site), the page shows the entries kept in the repo.

Code: `app/updates/github.ts` (reading and parsing GitHub), `app/updates/data.ts`
(merging), `tests/updates-github.test.ts`.

## Publishing a release so it shows up well (for the desktop app's release process)

The desktop app's agent (local folder `spetotext`), which publishes every release to `sinhgiang/wispra-releases`,
does this as part of every release. Nothing needs to happen in wispra-web.

1. **Write the release notes for people who use the app**, in Markdown, with
   these headings and `- ` bullets. Leave out any heading that has nothing under it:

   ```markdown
   Optional: one or two sentences before the first heading become the summary.

   ## New
   - **Short bold lead.** What the user can now do, in plain English.

   ## Improved
   - …

   ## Fixed
   - …
   ```

   Headings are matched loosely ("What's new", "Bug fixes" also work); other
   headings such as "Install" are not shown. `**bold**` and `` `code` `` are
   rendered; keep everything else plain text. A release with no bullet under New,
   Improved or Fixed is not shown.

2. **Give the release a headline** in its title: `v0.6.6 — Mind maps you can edit`.
   If the title is only the version (`v0.6.6`), the page uses the first bold
   phrase of the notes as the headline.

3. **Attach a screenshot** to the release as an asset named exactly
   `screenshot.png`:
   - the screen that shows what this release changed, dark mode;
   - **1600 × 1000 pixels** (16:10), ideally under 500 KB;
   - **sample content only**: invented titles and text, fake emails such as
     `alex@example.com`, masked keys. No real names, recordings, email
     addresses, Windows user names or file paths. The site is public.

   With the GitHub CLI:
   `gh release upload v0.6.6 screenshot.png -R sinhgiang/wispra-releases`

4. Publish the release (not a draft, not a pre-release; those are skipped). The
   tag must look like `v0.6.6`.

5. Within an hour, check `https://wispra-web.vercel.app/updates`: the new version
   is at the top with the Latest badge, its notes and its screenshot.

Editing the notes or the screenshot on GitHub later also reaches the page within
an hour.

## Rewriting an entry in this repo (optional)

To replace GitHub's text or image for a version with a hand-written one, add an
object at the right place in `RELEASES` in `app/updates/releases.ts` (newest first)
and the image as `public/updates/<version>.webp` (1600 × 1000, WebP, under about
250 KB). `npm test` fails if the list is out of order, an entry has no changes,
or its image is missing or too large. This needs a pull request and a deploy.

To convert a PNG: `node -e "require('sharp')('in.png').resize(1600,1000).webp({quality:82}).toFile('public/updates/0.6.6.webp')"`.

## Screenshots of 0.1.0 – 0.6.5

The first 28 screenshots were made after the fact, not captured from the running
app. Each screen was rebuilt as a static page from that version's own stylesheet
and markup (taken from the app repository at the version's tag), or from the app's
two design prototypes for the mind map and four-column transcript, then rendered
with headless Chrome. Window frames, the Windows desktop, notifications and the
sample apps being dictated into were drawn by hand, and some images have a soft
ring around the setting that changed. All text is invented sample content.
