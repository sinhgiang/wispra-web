import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { LATEST, RELEASES, findRelease, formatReleaseDate, releaseImage } from '@/app/updates/releases'

const PUBLIC_DIR = join(__dirname, '..', 'public')

const semver = (v: string) => v.split('.').map(Number)
const isNewer = (a: string, b: string) => {
  const [x, y] = [semver(a), semver(b)]
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]
  return false
}

describe('Updates page data (app/updates/releases.ts)', () => {
  it('lists versions newest first, once each, with valid numbers and dates', () => {
    const versions = RELEASES.map(r => r.version)
    expect(new Set(versions).size).toBe(versions.length)
    for (const r of RELEASES) {
      expect(r.version).toMatch(/^\d+\.\d+\.\d+$/)
      expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(Number.isNaN(Date.parse(r.date))).toBe(false)
    }
    for (let i = 1; i < RELEASES.length; i++) {
      expect(isNewer(RELEASES[i - 1].version, RELEASES[i].version), `${RELEASES[i - 1].version} before ${RELEASES[i].version}`).toBe(true)
      expect(RELEASES[i - 1].date >= RELEASES[i].date, `date of ${RELEASES[i - 1].version}`).toBe(true)
    }
    expect(LATEST).toBe(RELEASES[0])
  })

  it('every release has a title, at least one change and screenshot alt text', () => {
    for (const r of RELEASES) {
      expect(r.title.trim(), r.version).not.toBe('')
      expect((r.new?.length ?? 0) + (r.improved?.length ?? 0) + (r.fixed?.length ?? 0), r.version).toBeGreaterThan(0)
      expect(r.imageAlt.trim(), r.version).not.toBe('')
    }
  })

  it('every release has its screenshot in public/updates, and no image is left without a release', () => {
    for (const r of RELEASES) {
      const file = join(PUBLIC_DIR, releaseImage(r.version))
      expect(existsSync(file), `missing ${releaseImage(r.version)}`).toBe(true)
      expect(statSync(file).size, `${releaseImage(r.version)} is too large`).toBeLessThan(600 * 1024)
    }
    const images = readdirSync(join(PUBLIC_DIR, 'updates'))
    expect(images.sort()).toEqual(RELEASES.map(r => `${r.version}.webp`).sort())
  })

  it('covers every version up to 0.6.5', () => {
    expect(findRelease('0.6.5')).toBeDefined()
    expect(findRelease('0.1.0')).toBeDefined()
    expect(RELEASES.length).toBeGreaterThanOrEqual(28)
  })

  it('formats dates the same everywhere', () => {
    expect(formatReleaseDate('2026-10-03')).toBe('Oct 3, 2026')
  })
})
