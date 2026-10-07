import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import nextConfig from '../next.config'

// T-0201 (C1): the installed framework and the packages it brings must be past
// the published fixes, and the unused image optimizer must stay off.

const lock = JSON.parse(readFileSync(join(__dirname, '..', 'package-lock.json'), 'utf8')) as {
  packages: Record<string, { version?: string }>
}

/** Every installed copy of a package (top level and nested), as [path, version]. */
function installed(name: string): [string, string][] {
  return Object.entries(lock.packages)
    .filter(([path]) => path === `node_modules/${name}` || path.endsWith(`/node_modules/${name}`))
    .map(([path, info]) => [path, info.version ?? '0.0.0'])
}

const parts = (v: string) => v.split(/[.-]/).slice(0, 3).map(Number)
function atLeast(version: string, minimum: string): boolean {
  const a = parts(version)
  const b = parts(minimum)
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]
  return true
}

describe('dependencies are past the published fixes', () => {
  it.each([
    ['next', '15.5.24'], // GHSA-2xp9-vwfh-vxw4, GHSA-p293-qw3h-jr36 and the 15.5.21 fixes
    ['react', '19.2.3'],
    ['react-dom', '19.2.3'],
    ['postcss', '8.5.23'], // GHSA-6g55-p6wh-862q, GHSA-fxqj-rqcc-2cmp, GHSA-r28c-9q8g-f849
    ['sharp', '0.35.5'], // libvips, libheif, librsvg advisories
    ['source-map-js', '1.2.2'], // GHSA-68fv-2mgg-jv7q
  ])('every installed %s is at least %s', (name, minimum) => {
    const copies = installed(name)
    expect(copies.length, `${name} is not in package-lock.json`).toBeGreaterThan(0)
    for (const [path, version] of copies) expect(atLeast(version, minimum), `${path} is ${version}`).toBe(true)
  })

  it('the version check itself tells old from new', () => {
    expect(atLeast('15.5.19', '15.5.24')).toBe(false)
    expect(atLeast('15.5.27', '15.5.24')).toBe(true)
    expect(atLeast('8.4.31', '8.5.23')).toBe(false)
    expect(atLeast('16.0.0', '15.5.24')).toBe(true)
  })
})

describe('next.config', () => {
  it('turns the image optimizer off', () => {
    expect(nextConfig.images?.unoptimized).toBe(true)
  })
})
