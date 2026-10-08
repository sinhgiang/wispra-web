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
    version: '10',
    date: '2026-10-06',
    title: 'Wispra for iPhone, build 10',
    summary: 'Your words, spelled your way.',
    new: [
      '**Custom vocabulary** (Account). List the names and terms you want spelled exactly — Github, Capcut, TikTok, your own name. Wispra listens for them and, when speech recognition writes one differently ("git hub", "Tik Tok", "Lenvit"), puts your spelling back. It works everywhere you dictate: the keyboard\'s mic, the mic button and meetings. Paste a whole list at once.',
      '**Learned** (Account). The same Learned section as on the computer: words learned from the fixes you make in History, names Wispra picked up from your History (keep or remove them), suggestions, your writing style and habits, and a measure of whether learning is helping. A switch turns learning off and keeps your lists.',
    ],
    fixed: [
      'Tapping the keyboard\'s mic no longer shows "Sign in first" to an account that is signed in. Wispra now waits for your saved sign-in to be read, says "Checking your account…", and if the phone will not hand it over (for instance right after a restart, while locked) tells you so and lets you try again. Your sign-in is kept readable after the first unlock.',
    ],
    imageAlt: 'Wispra for iPhone, build 10',
    image: null,
    source: 'repo',
    screens: [
      { src: null, caption: 'Account with Custom vocabulary and Learned' },
      { src: null, caption: 'Custom vocabulary with a list of terms' },
      { src: null, caption: 'Learned' },
      { src: null, caption: 'Text typed by the keyboard, with the terms spelled right' },
    ],
  },
  {
    version: '8',
    date: '2026-10-06',
    title: 'Wispra for iPhone, build 8',
    summary: 'Open a dictation in History, copy it, and correct it so Wispra learns.',
    new: [
      '**A dictation opens in full.** Tap a dictation in History to read all of its words.',
      '**Copy.** One tap copies the text to paste into any app.',
      '**Edit.** Fix the words Wispra got wrong. Wispra learns your spelling from what you change, as on the computer: fix a word once and it is remembered, fix it again and it is replaced by itself in every next dictation, by voice, in meetings and through the keyboard. Changes of punctuation or capitals only, and texts rewritten broadly, teach nothing.',
    ],
    notes: ['Your edit stays on the phone (the computer keeps its own edits too). The first text is kept.'],
    imageAlt: 'Wispra for iPhone, build 8',
    image: null,
    source: 'repo',
    screens: [
      { src: null, caption: 'A dictation open in History, with Edit and Copy' },
      { src: null, caption: 'The "Learned: …" notice after saving an edit' },
    ],
  },
  {
    version: '7',
    date: '2026-10-06',
    title: 'Wispra for iPhone, build 7',
    summary: 'The keyboard now tells you when it cannot hear you.',
    new: [
      '**Keyboard log** (Account). What Wispra and its keyboard noted about the listening session, newest first, with the likeliest cause on top and a Share button, so a problem in one app can be traced.',
    ],
    fixed: [
      'In some apps (Messenger, Zalo) the keyboard could stay on "Writing…" for ever. If iOS stops Wispra while you speak, the keyboard now says so within seconds ("Wispra was stopped by iPhone, your words did not arrive. Open Wispra and speak again") and keeps the message until your next tap. A microphone shown as listening, while Wispra is gone, turns back to ready.',
    ],
    imageAlt: 'Wispra for iPhone, build 7',
    image: null,
    source: 'repo',
    screens: [{ src: null, caption: 'Account › Keyboard log, with a log entry' }],
  },
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
