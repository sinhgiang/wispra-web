// The newest Wispra desktop release on GitHub, for the download buttons.
// Read on the server; the home page re-checks it every hour (see app/page.tsx),
// so a new release shows up on the site without a code change.

import { LATEST_RELEASE_API, RELEASES_URL } from '@/lib/wispra-releases'

export { RELEASES_URL }

export interface LatestRelease {
  /** e.g. '0.6.5', or null when GitHub could not be reached. */
  version: string | null
  /** Direct link to the Windows installer, or the latest-release page as a fallback. */
  windowsUrl: string
  /** Direct link to the macOS disk image, or the latest-release page as a fallback. */
  macUrl: string
}

const FALLBACK: LatestRelease = {
  version: null,
  windowsUrl: `${RELEASES_URL}/latest`,
  macUrl: `${RELEASES_URL}/latest`,
}

interface GitHubRelease {
  tag_name?: unknown
  assets?: { name?: unknown; browser_download_url?: unknown }[]
}

/** Picks the installers out of a GitHub "latest release" response. */
export function pickDownloads(release: GitHubRelease): LatestRelease {
  const tag = typeof release.tag_name === 'string' ? release.tag_name : ''
  const version = /^v?(\d+\.\d+\.\d+)$/.exec(tag)?.[1] ?? null
  const assets = (release.assets ?? []).filter(
    (a): a is { name: string; browser_download_url: string } =>
      typeof a.name === 'string' && typeof a.browser_download_url === 'string'
  )
  const find = (test: (name: string) => boolean) => assets.find(a => test(a.name))?.browser_download_url

  return {
    version,
    windowsUrl: find(n => /\.exe$/i.test(n) && /setup/i.test(n)) ?? find(n => /\.exe$/i.test(n)) ?? FALLBACK.windowsUrl,
    macUrl: find(n => /\.dmg$/i.test(n)) ?? FALLBACK.macUrl,
  }
}

/** Never throws: if GitHub is unreachable the buttons open the latest-release page. */
export async function getLatestRelease(): Promise<LatestRelease> {
  try {
    const res = await fetch(LATEST_RELEASE_API, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'wispra-web' },
      next: { revalidate: 3600 },
    })
    if (!res.ok) {
      console.error(`[latest-release] GitHub answered ${res.status}`)
      return FALLBACK
    }
    return pickDownloads(await res.json())
  } catch (err) {
    console.error('[latest-release] could not reach GitHub:', err)
    return FALLBACK
  }
}
