import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { IPHONE_RELEASES, LATEST_IPHONE, findIphoneRelease } from '@/app/updates/iphone'
import IphoneUpdatesPage from '@/app/updates/iphone/page'
import IphoneBuildPage, { generateStaticParams } from '@/app/updates/iphone/[build]/page'
import { hrefFor, trackOf, versionLabel } from '@/app/updates/links'

describe('Wispra for iPhone on the Updates page', () => {
  it('has build 6 with the notes as written', () => {
    expect(IPHONE_RELEASES.map(r => r.version)).toEqual(['6'])
    expect(LATEST_IPHONE).toMatchObject({
      version: '6',
      title: 'Wispra for iPhone, build 6',
      summary: 'Dictation by keyboard gets closer to one tap.',
    })
    expect(LATEST_IPHONE.improved).toHaveLength(2)
    expect(LATEST_IPHONE.improved?.[0]).toMatch(/^\*\*Keep the microphone ready\.\*\* The Wispra keyboard's mic starts speaking at once/)
    expect(LATEST_IPHONE.improved?.[0]).toContain('Sessions now last 4 hours by default (1, 4 or 12 hours in Account)')
    expect(LATEST_IPHONE.improved?.[1]).toBe(
      '**Punctuation.** Words typed by the keyboard come with full stops, commas and capital letters, and nothing else changed.'
    )
    expect(LATEST_IPHONE.fixed).toEqual([
      'Dragging the Recording bar or the mind map no longer pulls the whole page away on iOS 26; only a swipe from the left edge goes back.',
    ])
    expect(LATEST_IPHONE.new).toBeUndefined()
  })

  it('leaves room for three screenshots until real ones (sample content only) are added', () => {
    expect(LATEST_IPHONE.screens).toHaveLength(3)
    for (const screen of LATEST_IPHONE.screens) expect(screen.src).toBeNull()
  })

  it('is kept in this repository, apart from the desktop releases repository', () => {
    const desktop = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'wispra-releases.json'), 'utf8')) as { name: string }[]
    expect(desktop.some(r => /iphone/i.test(r.name))).toBe(false)
  })

  it('/updates/iphone shows build 6 as Latest, its notes and the screenshot places', () => {
    const html = renderToStaticMarkup(IphoneUpdatesPage())

    expect(html).toContain('Build 6')
    expect(html).toContain('Latest')
    expect(html).toContain('Wispra for iPhone, build 6')
    expect(html).toContain('Dictation by keyboard gets closer to one tap.')
    expect(html).toContain('<strong class="font-semibold text-text-primary">Keep the microphone ready.</strong>')
    expect(html).toContain('Improved')
    expect(html).toContain('Fixed')
    expect(html.split('Screenshot coming soon').length - 1).toBe(3)
    expect(html).toContain('Account: the listening session, 4 hours, with the explanation')
    expect(html).not.toContain('v6')
  })

  it('links and labels follow the product', () => {
    expect(trackOf('/updates')).toBe('desktop')
    expect(trackOf('/updates/0.6.4')).toBe('desktop')
    expect(trackOf('/updates/iphone')).toBe('iphone')
    expect(trackOf('/updates/iphone/5')).toBe('iphone')
    expect(trackOf('/updates/iphones')).toBe('desktop')

    expect(hrefFor('6', '6', 'iphone')).toBe('/updates/iphone')
    expect(hrefFor('5', '6', 'iphone')).toBe('/updates/iphone/5')
    expect(hrefFor('0.6.7', '0.6.7')).toBe('/updates')
    expect(hrefFor('0.6.4', '0.6.7')).toBe('/updates/0.6.4')

    expect(versionLabel('6', 'iphone')).toBe('Build 6')
    expect(versionLabel('0.6.7')).toBe('v0.6.7')
  })

  it('/updates/iphone/6 goes to /updates/iphone; an unknown build is not found', async () => {
    expect(generateStaticParams()).toEqual([{ build: '6' }])
    expect(findIphoneRelease('7')).toBeUndefined()

    await expect(IphoneBuildPage({ params: Promise.resolve({ build: '6' }) })).rejects.toMatchObject({
      digest: expect.stringContaining('/updates/iphone'),
    })
    await expect(IphoneBuildPage({ params: Promise.resolve({ build: '7' }) })).rejects.toMatchObject({
      digest: expect.stringContaining('404'),
    })
  })
})
