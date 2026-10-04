// The list the Updates pages show: the entries kept in this repo
// (releases.ts, with their own text and images) plus any newer release on
// GitHub that is not in the repo yet. A version kept in the repo always wins.

import { cache } from 'react'
import { RELEASES, releaseImage, type Release } from './releases'
import { fetchGitHubReleases, type GitHubEntry } from './github'

export interface UpdateEntry extends Release {
  /** Screenshot URL, or null when the release has none. */
  image: string | null
  /** Where the entry came from. */
  source: 'repo' | 'github'
}

const semver = (v: string) => v.split('.').map(Number)
function compareNewestFirst(a: UpdateEntry, b: UpdateEntry): number {
  const [x, y] = [semver(a.version), semver(b.version)]
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return y[i] - x[i]
  return 0
}

/** Pure merge, newest first; exported for tests. */
export function mergeReleases(repo: Release[], github: GitHubEntry[]): UpdateEntry[] {
  const kept = new Set(repo.map(r => r.version))
  const entries: UpdateEntry[] = [
    ...repo.map(r => ({ ...r, image: releaseImage(r.version), source: 'repo' as const })),
    ...github.filter(g => !kept.has(g.version)).map(g => ({ ...g, source: 'github' as const })),
  ]
  return entries.sort(compareNewestFirst)
}

/** The Updates list for this request (GitHub is re-read at most once an hour). */
export const getUpdates = cache(async (): Promise<UpdateEntry[]> => {
  return mergeReleases(RELEASES, await fetchGitHubReleases())
})
