/**
 * The Updates page has one list per product:
 * - desktop (Mac & Windows): /updates for the latest, /updates/<version> for the others;
 * - iPhone: /updates/iphone for the latest build, /updates/iphone/<build> for the others.
 */
export type Track = 'desktop' | 'iphone'

export const TRACK_BASE: Record<Track, string> = {
  desktop: '/updates',
  iphone: '/updates/iphone',
}

export const TRACK_LABEL: Record<Track, string> = {
  desktop: 'Mac & Windows',
  iphone: 'iPhone',
}

/** Which list a URL belongs to. */
export function trackOf(pathname: string): Track {
  return pathname === TRACK_BASE.iphone || pathname.startsWith(`${TRACK_BASE.iphone}/`) ? 'iphone' : 'desktop'
}

/** The latest entry of a list lives at the list's base URL; the others below it. */
export function hrefFor(version: string, latestVersion: string, track: Track = 'desktop'): string {
  const base = TRACK_BASE[track]
  return version === latestVersion ? base : `${base}/${version}`
}

/** "v0.6.7" for the desktop app, "Build 6" for the iPhone app. */
export function versionLabel(version: string, track: Track = 'desktop'): string {
  return track === 'iphone' ? `Build ${version}` : `v${version}`
}
