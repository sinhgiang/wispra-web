import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { parseReleaseNotes, toEntry, fetchGitHubReleases, type GitHubRelease } from '@/app/updates/github'
import { mergeReleases, getUpdates } from '@/app/updates/data'
import { RELEASES } from '@/app/updates/releases'
import UpdatesPage from '@/app/updates/page'

const DL = 'https://github.com/sinhgiang/wispra/releases/download'

// Real release notes of v0.6.5, as published on GitHub.
const BODY_065 = `## New
- **Backup AI when the daily limit is reached.** When Groq's gpt-oss-120b reaches its daily limit on your own key, mind maps carry on with a smaller model.
- **Cloudflare Workers AI as a free backup.** Settings → Account → "Backup when the AI reaches its daily limit".

## Improved
- **Older recordings no longer start AI by themselves.** Only recordings made after this update get topics automatically.
`

// Older style (v0.4.0): a "What's new" heading, a paragraph, bullets, then an Install section.
const BODY_040 = `## What's new

**Wispra now learns from you.** A new **Learned** tab in Settings builds a personal memory.

- **Your words:** fix a misheard word once and the AI cleanup gets it as a hint;
  fix it again and it is replaced automatically.
- **Suggestions:** Wispra suggests recurring mishearings.

## Fixed

- Running a development build could overwrite **Launch at login**.

## Install

Download \`Wispra-Setup-0.4.0.exe\` below and run it.
`

const release = (over: Partial<GitHubRelease> & { tag_name: string }): GitHubRelease => ({
  name: over.tag_name,
  draft: false,
  prerelease: false,
  published_at: '2026-10-10T09:00:00Z',
  body: '## New\n- Something new.\n',
  assets: [],
  ...over,
})

const asset = (version: string, name: string) => ({ name, browser_download_url: `${DL}/v${version}/${name}` })

describe('reading release notes from GitHub', () => {
  it('splits the New / Improved / Fixed bullets of a real release', () => {
    const notes = parseReleaseNotes(BODY_065)
    expect(notes.new).toHaveLength(2)
    expect(notes.new?.[0]).toMatch(/^\*\*Backup AI when the daily limit is reached\.\*\* When Groq/)
    expect(notes.improved).toEqual([
      '**Older recordings no longer start AI by themselves.** Only recordings made after this update get topics automatically.',
    ])
    expect(notes.fixed).toBeUndefined()
    expect(notes.summary).toBeUndefined()
  })

  it('handles the older format: wrapped bullets kept whole, Install section left out', () => {
    const notes = parseReleaseNotes(BODY_040)
    expect(notes.new).toEqual([
      '**Your words:** fix a misheard word once and the AI cleanup gets it as a hint; fix it again and it is replaced automatically.',
      '**Suggestions:** Wispra suggests recurring mishearings.',
    ])
    expect(notes.fixed).toEqual(['Running a development build could overwrite **Launch at login**.'])
    expect(JSON.stringify(notes)).not.toContain('Wispra-Setup')
  })

  it('keeps text before the first heading as the summary', () => {
    expect(parseReleaseNotes('Faster and calmer.\n\n## Fixed\n- A bug.').summary).toBe('Faster and calmer.')
  })

  it('builds an entry with the screenshot.png asset as its image', () => {
    const entry = toEntry(
      release({
        tag_name: 'v0.6.6',
        name: 'v0.6.6 — Mind maps you can edit',
        body: BODY_065,
        assets: [asset('0.6.6', 'Wispra-Setup-0.6.6.exe'), asset('0.6.6', 'screenshot.png')],
      })
    )
    expect(entry).toMatchObject({
      version: '0.6.6',
      date: '2026-10-10',
      title: 'Mind maps you can edit',
      image: `${DL}/v0.6.6/screenshot.png`,
      imageAlt: 'Wispra v0.6.6',
    })
    expect(entry?.new).toHaveLength(2)
  })

  it('without a headline in the name, uses the first bold phrase; without a screenshot, no image', () => {
    const entry = toEntry(release({ tag_name: 'v0.6.6', body: BODY_065 }))
    expect(entry?.title).toBe('Backup AI when the daily limit is reached')
    expect(entry?.image).toBeNull()
  })

  it('skips drafts, pre-releases, odd tags and releases with no change listed', () => {
    expect(toEntry(release({ tag_name: 'v0.6.6', draft: true }))).toBeNull()
    expect(toEntry(release({ tag_name: 'v0.7.0-beta.1', prerelease: true }))).toBeNull()
    expect(toEntry(release({ tag_name: 'nightly' }))).toBeNull()
    expect(toEntry(release({ tag_name: 'v0.6.6', body: 'Just a note.' }))).toBeNull()
  })
})

describe('merging GitHub with the entries kept in the repo', () => {
  it('a version kept in the repo keeps its own text and image', () => {
    const gh = toEntry(release({ tag_name: 'v0.6.5', name: 'v0.6.5 — From GitHub', assets: [asset('0.6.5', 'screenshot.png')] }))!
    const merged = mergeReleases(RELEASES, [gh])
    const e065 = merged.find(e => e.version === '0.6.5')!
    expect(e065.source).toBe('repo')
    expect(e065.title).toBe(RELEASES[0].title)
    expect(e065.image).toBe('/updates/0.6.5.webp')
    expect(merged).toHaveLength(RELEASES.length)
  })

  it('a newer GitHub release goes on top, then the repo entries in order', () => {
    const gh = toEntry(release({ tag_name: 'v0.6.6', body: BODY_065, assets: [asset('0.6.6', 'screenshot.png')] }))!
    const merged = mergeReleases(RELEASES, [gh])
    expect(merged.map(e => e.version).slice(0, 3)).toEqual(['0.6.6', '0.6.5', '0.6.4'])
    expect(merged[0]).toMatchObject({ source: 'github', image: `${DL}/v0.6.6/screenshot.png` })
    expect(merged).toHaveLength(RELEASES.length + 1)
  })

  it('orders by version number, not text (0.10.0 is newer than 0.9.0)', () => {
    const merged = mergeReleases([], [toEntry(release({ tag_name: 'v0.9.0' }))!, toEntry(release({ tag_name: 'v0.10.0' }))!])
    expect(merged.map(e => e.version)).toEqual(['0.10.0', '0.9.0'])
  })
})

describe('the /updates page with GitHub', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('reads the GitHub releases API, re-checked hourly', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('[]', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await fetchGitHubReleases()
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.github.com/repos/sinhgiang/wispra/releases?per_page=100')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ next: { revalidate: 3600 } })
  })

  it('when GitHub is down or rate-limited, shows exactly the repo entries', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('rate limited', { status: 403 })))
    expect(await fetchGitHubReleases()).toEqual([])
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    const updates = await getUpdates()
    expect(updates.map(e => e.version)).toEqual(RELEASES.map(r => r.version))
  })

  it('a new release published on GitHub appears on /updates with its notes and screenshot', async () => {
    const gh = [
      release({
        tag_name: 'v0.6.6',
        name: 'v0.6.6 — Mind maps you can edit',
        body: BODY_065,
        assets: [asset('0.6.6', 'Wispra-Setup-0.6.6.exe'), asset('0.6.6', 'screenshot.png')],
      }),
      release({ tag_name: 'v0.6.5', body: BODY_065 }),
    ]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(gh), { status: 200 })))

    const html = renderToStaticMarkup(await UpdatesPage())

    expect(html).toContain('v0.6.6')
    expect(html).toContain('Latest')
    expect(html).toContain('Mind maps you can edit')
    expect(html).toContain(`src="${DL}/v0.6.6/screenshot.png"`)
    expect(html).toContain('<strong class="font-semibold text-text-primary">Backup AI when the daily limit is reached.</strong>')
    // The older neighbour is the repo's own 0.6.5 entry.
    expect(html).toContain('href="/updates/0.6.5"')
  })
})
