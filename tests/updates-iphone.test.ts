import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { IPHONE_RELEASES, LATEST_IPHONE, findIphoneRelease } from '@/app/updates/iphone'
import IphoneUpdatesPage from '@/app/updates/iphone/page'
import IphoneBuildPage, { generateStaticParams } from '@/app/updates/iphone/[build]/page'
import { hrefFor, trackOf, versionLabel } from '@/app/updates/links'

const build = (n: string) => {
  const release = findIphoneRelease(n)
  if (!release) throw new Error(`no build ${n}`)
  return release
}

const renderBuild = async (n: string) => renderToStaticMarkup(await IphoneBuildPage({ params: Promise.resolve({ build: n }) }))

describe('Wispra for iPhone on the Updates page', () => {
  it('lists builds 10, 8, 7 and 6, newest first, with build 10 as the latest', () => {
    expect(IPHONE_RELEASES.map(r => r.version)).toEqual(['10', '8', '7', '6'])
    expect(LATEST_IPHONE.version).toBe('10')
  })

  it('build 10 has the notes as written', () => {
    expect(build('10')).toMatchObject({ title: 'Wispra for iPhone, build 10', summary: 'Your words, spelled your way.' })
    const [vocabulary, learned] = build('10').new ?? []
    expect(build('10').new).toHaveLength(2)
    expect(vocabulary.startsWith('**Custom vocabulary** (Account). List the names and terms you want spelled exactly — Github, Capcut, TikTok, your own name.')).toBe(true)
    expect(vocabulary).toContain('("git hub", "Tik Tok", "Lenvit")')
    expect(vocabulary.endsWith('Paste a whole list at once.')).toBe(true)
    expect(learned.startsWith('**Learned** (Account). The same Learned section as on the computer:')).toBe(true)
    expect(learned.endsWith('A switch turns learning off and keeps your lists.')).toBe(true)

    const [signIn] = build('10').fixed ?? []
    expect(build('10').fixed).toHaveLength(1)
    expect(signIn.startsWith(`Tapping the keyboard's mic no longer shows "Sign in first" to an account that is signed in.`)).toBe(true)
    expect(signIn).toContain('says "Checking your account…"')
    expect(signIn.endsWith('Your sign-in is kept readable after the first unlock.')).toBe(true)
    expect(build('10').improved).toBeUndefined()
  })

  it('build 8 has the notes as written, including "Good to know"', () => {
    expect(build('8')).toMatchObject({
      title: 'Wispra for iPhone, build 8',
      summary: 'Open a dictation in History, copy it, and correct it so Wispra learns.',
      notes: ['Your edit stays on the phone (the computer keeps its own edits too). The first text is kept.'],
    })
    expect(build('8').new).toEqual([
      '**A dictation opens in full.** Tap a dictation in History to read all of its words.',
      '**Copy.** One tap copies the text to paste into any app.',
      expect.stringMatching(/^\*\*Edit\.\*\* Fix the words Wispra got wrong\. .* Changes of punctuation or capitals only, and texts rewritten broadly, teach nothing\.$/),
    ])
    expect(build('8').improved).toBeUndefined()
    expect(build('8').fixed).toBeUndefined()
  })

  it('build 7 has the notes as written', () => {
    expect(build('7')).toMatchObject({
      title: 'Wispra for iPhone, build 7',
      summary: 'The keyboard now tells you when it cannot hear you.',
    })
    expect(build('7').new).toEqual([expect.stringMatching(/^\*\*Keyboard log\*\* \(Account\)\. What Wispra and its keyboard noted/)])
    expect(build('7').fixed).toEqual([
      expect.stringContaining('("Wispra was stopped by iPhone, your words did not arrive. Open Wispra and speak again")'),
    ])
  })

  it('build 6 keeps the notes as written', () => {
    expect(build('6')).toMatchObject({
      title: 'Wispra for iPhone, build 6',
      summary: 'Dictation by keyboard gets closer to one tap.',
    })
    expect(build('6').improved).toHaveLength(2)
    expect(build('6').improved?.[0]).toMatch(/^\*\*Keep the microphone ready\.\*\* The Wispra keyboard's mic starts speaking at once/)
    expect(build('6').improved?.[0]).toContain('Sessions now last 4 hours by default (1, 4 or 12 hours in Account)')
    expect(build('6').improved?.[1]).toBe(
      '**Punctuation.** Words typed by the keyboard come with full stops, commas and capital letters, and nothing else changed.'
    )
    expect(build('6').fixed).toEqual([
      'Dragging the Recording bar or the mind map no longer pulls the whole page away on iOS 26; only a swipe from the left edge goes back.',
    ])
  })

  it('every build leaves room for its screenshots until real ones (sample content only) are added', () => {
    expect(IPHONE_RELEASES.map(r => r.screens.length)).toEqual([4, 2, 1, 3])
    for (const release of IPHONE_RELEASES) for (const screen of release.screens) expect(screen.src).toBeNull()
  })

  it('is kept in this repository, apart from the desktop releases repository', () => {
    const desktop = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'wispra-releases.json'), 'utf8')) as { name: string }[]
    expect(desktop.some(r => /iphone/i.test(r.name))).toBe(false)
  })

  it('/updates/iphone shows build 10 as Latest, its notes and its four screenshot places', () => {
    const html = renderToStaticMarkup(IphoneUpdatesPage())

    expect(html).toContain('Build 10')
    expect(html).toContain('Latest')
    expect(html).toContain('Wispra for iPhone, build 10')
    expect(html).toContain('<strong class="font-semibold text-text-primary">Custom vocabulary</strong>')
    expect(html.split('Screenshot coming soon').length - 1).toBe(4)
    expect(html).toContain('grid-cols-2 sm:grid-cols-4')
    expect(html).toContain('href="/updates/iphone/8"')
    expect(html).not.toContain('v10')
  })

  it('/updates/iphone/8 shows build 8, its notes, "Good to know" and its screenshot places', async () => {
    const html = await renderBuild('8')

    expect(html).toContain('Build 8')
    expect(html).not.toContain('Latest')
    expect(html).toContain('Wispra for iPhone, build 8')
    expect(html).toContain('<strong class="font-semibold text-text-primary">A dictation opens in full.</strong>')
    expect(html).toContain('New')
    expect(html).toContain('Good to know')
    expect(html.split('Screenshot coming soon').length - 1).toBe(2)
    expect(html).toContain('A dictation open in History, with Edit and Copy')
    expect(html).toContain('href="/updates/iphone/7"')
    expect(html).toContain('href="/updates/iphone"')
    expect(html).not.toContain('v8')
  })

  it('/updates/iphone/7 and /updates/iphone/6 show their own build, linked to their neighbours', async () => {
    const seven = await renderBuild('7')
    expect(seven).toContain('Wispra for iPhone, build 7')
    expect(seven).toContain('Keyboard log')
    expect(seven.split('Screenshot coming soon').length - 1).toBe(1)
    expect(seven).toContain('href="/updates/iphone/8"')
    expect(seven).toContain('href="/updates/iphone/6"')
    expect(seven).not.toContain('Latest')

    const six = await renderBuild('6')
    expect(six).toContain('Wispra for iPhone, build 6')
    expect(six.split('Screenshot coming soon').length - 1).toBe(3)
    expect(six).toContain('href="/updates/iphone/7"')
  })

  it('links and labels follow the product', () => {
    expect(trackOf('/updates')).toBe('desktop')
    expect(trackOf('/updates/0.6.4')).toBe('desktop')
    expect(trackOf('/updates/iphone')).toBe('iphone')
    expect(trackOf('/updates/iphone/5')).toBe('iphone')
    expect(trackOf('/updates/iphones')).toBe('desktop')

    expect(hrefFor('10', '10', 'iphone')).toBe('/updates/iphone')
    expect(hrefFor('6', '10', 'iphone')).toBe('/updates/iphone/6')
    expect(hrefFor('0.6.7', '0.6.7')).toBe('/updates')
    expect(hrefFor('0.6.4', '0.6.7')).toBe('/updates/0.6.4')

    expect(versionLabel('8', 'iphone')).toBe('Build 8')
    expect(versionLabel('0.6.7')).toBe('v0.6.7')
  })

  it('/updates/iphone/10 goes to /updates/iphone; an unknown build is not found', async () => {
    expect(generateStaticParams()).toEqual([{ build: '10' }, { build: '8' }, { build: '7' }, { build: '6' }])
    expect(findIphoneRelease('9')).toBeUndefined()

    await expect(IphoneBuildPage({ params: Promise.resolve({ build: '10' }) })).rejects.toMatchObject({
      digest: expect.stringContaining('/updates/iphone'),
    })
    await expect(IphoneBuildPage({ params: Promise.resolve({ build: '9' }) })).rejects.toMatchObject({
      digest: expect.stringContaining('404'),
    })
  })
})
