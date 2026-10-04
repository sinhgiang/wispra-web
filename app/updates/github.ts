// Releases of the desktop app read from GitHub, so a new version shows up on
// /updates without a code change. The convention the app's release notes
// follow is described in docs/UPDATES.md.

import type { Release } from './releases'
import { ALL_RELEASES_API as RELEASES_API } from '@/lib/wispra-releases'

/** The asset name the app's release process attaches as the page's screenshot. */
export const SCREENSHOT_ASSET = 'screenshot.png'

/** How often the site re-reads GitHub, in seconds. */
export const GITHUB_REVALIDATE_SECONDS = 3600

export interface GitHubRelease {
  tag_name?: unknown
  name?: unknown
  body?: unknown
  draft?: unknown
  prerelease?: unknown
  published_at?: unknown
  assets?: { name?: unknown; browser_download_url?: unknown }[]
}

/** A release built from GitHub; `image` is the screenshot asset's URL, if any. */
export interface GitHubEntry extends Release {
  image: string | null
}

type Section = 'new' | 'improved' | 'fixed'

/** Maps a release-notes heading to a section; other headings (Install, Notes…) are skipped. */
function sectionOf(heading: string): Section | null {
  const h = heading.toLowerCase()
  if (/\bimprov/.test(h)) return 'improved'
  if (/\bfix|\bbug/.test(h)) return 'fixed'
  if (/\bnew\b|what'?s new|feature/.test(h)) return 'new'
  return null
}

/**
 * Reads GitHub release notes written as Markdown:
 *   optional paragraph (the summary), then `## New` / `## Improved` / `## Fixed`
 *   headings with `- ` bullets. Bullets may wrap onto indented lines.
 */
export function parseReleaseNotes(body: string): Pick<Release, 'summary' | Section> {
  const out: Pick<Release, 'summary' | Section> = {}
  let section: Section | null = null
  let inHeadingBlock = false
  const summary: string[] = []
  let current: string[] | null = null

  const flush = () => {
    if (current && section) {
      const text = current.join(' ').replace(/\s+/g, ' ').trim()
      if (text) (out[section] ??= []).push(text)
    }
    current = null
  }

  for (const raw of body.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trimEnd()
    const heading = /^#{1,6}\s+(.*)$/.exec(line)
    if (heading) {
      flush()
      section = sectionOf(heading[1])
      inHeadingBlock = true
      continue
    }
    const bullet = /^\s{0,3}[-*]\s+(.*)$/.exec(line)
    if (bullet) {
      flush()
      current = [bullet[1]]
      continue
    }
    if (current && /^\s+\S/.test(line)) {
      current.push(line.trim())
      continue
    }
    if (!line.trim()) {
      flush()
      continue
    }
    flush()
    // Plain text before the first heading is the summary.
    if (!inHeadingBlock) summary.push(line.trim())
  }
  flush()

  if (summary.length) out.summary = summary.join(' ')
  return out
}

/**
 * The headline: the release name after the version ("v0.6.6 — Faster mind maps"),
 * else the first bold phrase of the notes, else a generic line.
 */
function titleOf(name: string, version: string, notes: Pick<Release, Section>): string {
  const fromName = name
    .replace(/^\s*(wispra\s+)?v?\d+\.\d+\.\d+\s*/i, '')
    .replace(/^[\s:—–-]+/, '')
    .trim()
  if (fromName) return fromName

  const firstBullet = notes.new?.[0] ?? notes.improved?.[0] ?? notes.fixed?.[0] ?? ''
  const bold = /\*\*(.+?)\*\*/.exec(firstBullet)?.[1]?.replace(/[.:]\s*$/, '').trim()
  return bold || `What's new in Wispra ${version}`
}

/** One GitHub release → one Updates entry, or null for drafts, pre-releases and odd tags. */
export function toEntry(release: GitHubRelease): GitHubEntry | null {
  if (release.draft === true || release.prerelease === true) return null
  const tag = typeof release.tag_name === 'string' ? release.tag_name : ''
  const version = /^v?(\d+\.\d+\.\d+)$/.exec(tag)?.[1]
  if (!version) return null

  const published = typeof release.published_at === 'string' ? release.published_at : ''
  const date = /^\d{4}-\d{2}-\d{2}/.exec(published)?.[0]
  if (!date) return null

  const notes = parseReleaseNotes(typeof release.body === 'string' ? release.body : '')
  if (!notes.new?.length && !notes.improved?.length && !notes.fixed?.length) return null

  const screenshot = (release.assets ?? []).find(
    a => typeof a.name === 'string' && a.name.toLowerCase() === SCREENSHOT_ASSET
  )
  const image = typeof screenshot?.browser_download_url === 'string' ? screenshot.browser_download_url : null

  return {
    version,
    date,
    title: titleOf(typeof release.name === 'string' ? release.name : '', version, notes),
    ...notes,
    imageAlt: `Wispra v${version}`,
    image,
  }
}

/** All usable releases from GitHub, or [] if GitHub cannot be reached. Never throws. */
export async function fetchGitHubReleases(): Promise<GitHubEntry[]> {
  try {
    const res = await fetch(RELEASES_API, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'wispra-web' },
      next: { revalidate: GITHUB_REVALIDATE_SECONDS },
    })
    if (!res.ok) {
      console.error(`[updates] GitHub answered ${res.status}; showing the releases kept in the repo`)
      return []
    }
    const data: unknown = await res.json()
    if (!Array.isArray(data)) return []
    return data.map(r => toEntry(r as GitHubRelease)).filter((e): e is GitHubEntry => e !== null)
  } catch (err) {
    console.error('[updates] could not reach GitHub; showing the releases kept in the repo:', err)
    return []
  }
}
