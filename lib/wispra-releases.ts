// Where the desktop app's installers and release notes are published.
// A public repository with no source code, so the site keeps working when the
// app's source repository is private. Every download link, release link and
// GitHub API call on the site comes from here.

export const RELEASES_REPO = 'sinhgiang/wispra-releases'

/** https://github.com/sinhgiang/wispra-releases */
export const RELEASES_REPO_URL = `https://github.com/${RELEASES_REPO}`
/** The list of releases on GitHub. */
export const RELEASES_URL = `${RELEASES_REPO_URL}/releases`
/** Where users report problems. */
export const SUPPORT_URL = `${RELEASES_REPO_URL}/issues`

const API = `https://api.github.com/repos/${RELEASES_REPO}`
/** The release GitHub marks as Latest. */
export const LATEST_RELEASE_API = `${API}/releases/latest`
/** Every published release, newest first. */
export const ALL_RELEASES_API = `${API}/releases?per_page=100`
