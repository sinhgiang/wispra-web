import { afterEach, describe, expect, it, vi } from 'vitest'
import { getLatestRelease, pickDownloads, RELEASES_URL } from '@/lib/latest-release'

const BASE = 'https://github.com/sinhgiang/wispra/releases/download/v0.6.5'

// The asset list of the real v0.6.5 release.
const V065 = {
  tag_name: 'v0.6.5',
  assets: [
    'latest-mac.yml',
    'latest.yml',
    'Wispra-0.6.5-universal.dmg',
    'Wispra-0.6.5-universal.dmg.blockmap',
    'Wispra-0.6.5-universal.zip',
    'Wispra-0.6.5-universal.zip.blockmap',
    'Wispra-Setup-0.6.5.exe',
    'Wispra-Setup-0.6.5.exe.blockmap',
  ].map(name => ({ name, browser_download_url: `${BASE}/${name}` })),
}

describe('download buttons follow the latest GitHub release', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('picks the Windows installer and the macOS disk image of 0.6.5', () => {
    expect(pickDownloads(V065)).toEqual({
      version: '0.6.5',
      windowsUrl: `${BASE}/Wispra-Setup-0.6.5.exe`,
      macUrl: `${BASE}/Wispra-0.6.5-universal.dmg`,
    })
  })

  it('a newer release is picked up without code changes', () => {
    const next = {
      tag_name: 'v0.7.0',
      assets: ['Wispra-Setup-0.7.0.exe', 'Wispra-0.7.0-universal.dmg'].map(name => ({
        name,
        browser_download_url: `https://example.test/${name}`,
      })),
    }
    expect(pickDownloads(next)).toEqual({
      version: '0.7.0',
      windowsUrl: 'https://example.test/Wispra-Setup-0.7.0.exe',
      macUrl: 'https://example.test/Wispra-0.7.0-universal.dmg',
    })
  })

  it('falls back to the latest-release page when an installer is missing', () => {
    expect(pickDownloads({ tag_name: 'v0.6.6', assets: [] })).toEqual({
      version: '0.6.6',
      windowsUrl: `${RELEASES_URL}/latest`,
      macUrl: `${RELEASES_URL}/latest`,
    })
  })

  it('never throws when GitHub is down or rate-limited', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('rate limited', { status: 403 })))
    expect(await getLatestRelease()).toEqual({
      version: null,
      windowsUrl: `${RELEASES_URL}/latest`,
      macUrl: `${RELEASES_URL}/latest`,
    })

    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('offline')))
    expect((await getLatestRelease()).version).toBeNull()
  })

  it('reads the release from the GitHub API', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(V065), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    expect((await getLatestRelease()).version).toBe('0.6.5')
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.github.com/repos/sinhgiang/wispra/releases/latest')
  })
})
