/** The latest version lives at /updates; the others at /updates/<version>. */
export function hrefFor(version: string, latestVersion: string): string {
  return version === latestVersion ? '/updates' : `/updates/${version}`
}
