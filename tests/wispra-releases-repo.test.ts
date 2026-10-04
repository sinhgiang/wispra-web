import { afterEach, describe, expect, it, vi } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { getUpdates } from '@/app/updates/data'
import UpdatesPage from '@/app/updates/page'
import { RELEASES } from '@/app/updates/releases'
import { getLatestRelease, pickDownloads } from '@/lib/latest-release'
import { ALL_RELEASES_API, LATEST_RELEASE_API, RELEASES_URL } from '@/lib/wispra-releases'

// The real releases of sinhgiang/wispra-releases on 2026-10-04 (0.6.0 to 0.6.7, all
// copied there on that day, so their published_at is the copy date).
const FIXTURE = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'wispra-releases.json'), 'utf8')) as {
  tag_name: string
  published_at: string
  assets: { name: string; browser_download_url: string }[]
}[]
const DL = 'https://github.com/sinhgiang/wispra-releases/releases/download'

const serveGitHub = () =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === ALL_RELEASES_API) return new Response(JSON.stringify(FIXTURE), { status: 200 })
      if (url === LATEST_RELEASE_API) return new Response(JSON.stringify(FIXTURE[0]), { status: 200 })
      return new Response('not found', { status: 404 })
    })
  )

describe('Updates page and downloads read sinhgiang/wispra-releases', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('reads the releases and the Latest release from the releases repository', () => {
    expect(ALL_RELEASES_API).toBe('https://api.github.com/repos/sinhgiang/wispra-releases/releases?per_page=100')
    expect(LATEST_RELEASE_API).toBe('https://api.github.com/repos/sinhgiang/wispra-releases/releases/latest')
    expect(RELEASES_URL).toBe('https://github.com/sinhgiang/wispra-releases/releases')
  })

  it('the fixture holds the 8 releases 0.6.0 to 0.6.7, all published on the copy day', () => {
    expect(FIXTURE.map(r => r.tag_name).sort()).toEqual(['v0.6.0', 'v0.6.1', 'v0.6.2', 'v0.6.3', 'v0.6.4', 'v0.6.5', 'v0.6.6', 'v0.6.7'])
    expect(new Set(FIXTURE.map(r => r.published_at.slice(0, 10)))).toEqual(new Set(['2026-10-04']))
  })

  it('shows all 8 in version order, 0.6.7 first, then the older releases kept in this repo', async () => {
    serveGitHub()
    const updates = await getUpdates()

    expect(updates.slice(0, 8).map(u => u.version)).toEqual(['0.6.7', '0.6.6', '0.6.5', '0.6.4', '0.6.3', '0.6.2', '0.6.1', '0.6.0'])
    expect(updates.slice(8).map(u => u.version)).toEqual(RELEASES.filter(r => r.version < '0.6.0').map(r => r.version))
    expect(updates).toHaveLength(RELEASES.length + 2)
  })

  it('0.6.6 and 0.6.7 come from GitHub with their headline and screenshot.png', async () => {
    serveGitHub()
    const [v067, v066] = await getUpdates()

    expect(v067).toMatchObject({
      version: '0.6.7',
      source: 'github',
      title: 'Long Cloud dictations, no invented sentences',
      image: `${DL}/v0.6.7/screenshot.png`,
      date: '2026-10-04',
    })
    expect(v066).toMatchObject({
      version: '0.6.6',
      source: 'github',
      title: 'The meeting table fills in while you talk',
      image: `${DL}/v0.6.6/screenshot.png`,
      date: '2026-10-04',
    })
  })

  it('0.6.0 to 0.6.5 keep their original release dates, not the copy date', async () => {
    serveGitHub()
    const updates = await getUpdates()
    const dates = Object.fromEntries(updates.map(u => [u.version, u.date]))

    expect(dates).toMatchObject({
      '0.6.5': '2026-10-03',
      '0.6.4': '2026-10-03',
      '0.6.3': '2026-10-03',
      '0.6.2': '2026-10-02',
      '0.6.1': '2026-10-02',
      '0.6.0': '2026-10-02',
    })
    expect(updates.find(u => u.version === '0.6.3')?.image).toBe('/updates/0.6.3.webp')
  })

  it('the page shows 0.6.7 as Latest with its screenshot from the releases repository', async () => {
    serveGitHub()
    const html = renderToStaticMarkup(await UpdatesPage())

    expect(html).toContain('v0.6.7')
    expect(html).toContain('Latest')
    expect(html).toContain('Long Cloud dictations, no invented sentences')
    expect(html).toContain(`src="${DL}/v0.6.7/screenshot.png"`)
    expect(html).toContain('href="/updates/0.6.6"')
  })

  it('the download buttons point at the 0.6.7 installers in the releases repository', async () => {
    serveGitHub()
    expect(pickDownloads(FIXTURE[0])).toEqual({
      version: '0.6.7',
      windowsUrl: `${DL}/v0.6.7/Wispra-Setup-0.6.7.exe`,
      macUrl: `${DL}/v0.6.7/Wispra-0.6.7-universal.dmg`,
    })
    expect((await getLatestRelease()).version).toBe('0.6.7')
  })

  it('no code, page or doc still points at the old sinhgiang/wispra repository', () => {
    const root = join(__dirname, '..')
    const files: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) walk(path)
        else if (/\.(tsx?|md|json)$/.test(name)) files.push(path)
      }
    }
    for (const dir of ['app', 'lib', 'docs']) walk(join(root, dir))
    files.push(join(root, 'README.md'))

    const old = /sinhgiang\/wispra(?![-\w])/
    const offenders = files.filter(f => old.test(readFileSync(f, 'utf8'))).map(f => f.slice(root.length + 1))
    expect(offenders).toEqual([])
  })
})
