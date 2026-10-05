// Wispra for iPhone on the Updates page (/updates/iphone).
//
// Kept here, not in sinhgiang/wispra-releases: that repository feeds the desktop
// app's automatic updates, and an iPhone build there would be offered to it.
// Newest first; `version` is the TestFlight build number. How to add a build:
// docs/UPDATES.md, "Wispra for iPhone".

import type { UpdateEntry } from './data'

/** One phone screenshot of a build: `src` null until a real one is added. */
export interface PhoneScreen {
  /** /updates/iphone/build-<n>-<k>.webp, or null for "screenshot coming soon". */
  src: string | null
  /** What the screenshot shows (also its alt text). */
  caption: string
}

export interface IphoneRelease extends UpdateEntry {
  screens: PhoneScreen[]
}

export const IPHONE_RELEASES: IphoneRelease[] = [
  {
    version: '6',
    date: '2026-10-06',
    title: 'Wispra for iPhone, build 6',
    summary: 'Dictation by keyboard gets closer to one tap.',
    improved: [
      "**Keep the microphone ready.** The Wispra keyboard's mic starts speaking at once while its listening session runs. Sessions now last 4 hours by default (1, 4 or 12 hours in Account), renew every time you use the mic, start by themselves when you open Wispra, and recover after a phone call, Siri or headphones. Apple lets only the app start the microphone, so Wispra still has to open the first time, after a restart, or when you end the session; the guide now says so plainly.",
      '**Punctuation.** Words typed by the keyboard come with full stops, commas and capital letters, and nothing else changed.',
    ],
    fixed: [
      'Dragging the Recording bar or the mind map no longer pulls the whole page away on iOS 26; only a swipe from the left edge goes back.',
    ],
    imageAlt: 'Wispra for iPhone, build 6',
    image: null,
    source: 'repo',
    screens: [
      { src: null, caption: 'Account: the listening session, 4 hours, with the explanation' },
      { src: null, caption: 'A meeting with the Recording bar' },
      { src: null, caption: 'Text typed by the Wispra keyboard, with punctuation' },
    ],
  },
]

export const LATEST_IPHONE = IPHONE_RELEASES[0]

export function findIphoneRelease(build: string): IphoneRelease | undefined {
  return IPHONE_RELEASES.find(r => r.version === build)
}
