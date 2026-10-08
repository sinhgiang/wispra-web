// What changed in each Wispra release, written for people who use the app.
// Newest first. These entries are kept in the repo with their own images; a
// newer release published on GitHub shows up on /updates by itself (see
// data.ts and github.ts), and an entry here always wins over GitHub's for the
// same version. How releases reach the page: see docs/UPDATES.md.

export interface Release {
  /** Without the "v", e.g. '0.6.5'. Also the URL (/updates/0.6.5) and the image name. */
  version: string
  /** Release day, 'YYYY-MM-DD'. */
  date: string
  /** One short line: the headline of the release. */
  title: string
  /** Optional one or two sentences under the headline. */
  summary?: string
  new?: string[]
  improved?: string[]
  fixed?: string[]
  /** Shown last as "Good to know": limits or behaviour worth knowing, not a change. */
  notes?: string[]
  /** What the screenshot shows, for screen readers. */
  imageAlt: string
}

export const RELEASES: Release[] = [
  {
    version: '0.6.5',
    date: '2026-10-03',
    title: 'A backup AI for when your daily limit runs out',
    summary:
      'Hit the daily limit on your own AI key and Wispra now keeps going with a backup model instead of stopping.',
    new: [
      'Backup AI when the daily limit is reached. Mind maps, topics, summaries and posts carry on with a smaller Groq model, then with Cloudflare Workers AI if you set it up. Anything a backup model wrote is labelled as such.',
      'Cloudflare Workers AI as a free backup. Add your Cloudflare Account ID and an API token under Settings → Account. Wispra tests them before saving, never shows the token again, and stops for the day before the free allowance is used up.',
    ],
    improved: [
      'Older recordings no longer start the AI on their own. Only new recordings get topics and action items automatically; older ones show a "Create topics and action items" button, so browsing old meetings no longer eats your daily allowance.',
    ],
    imageAlt: 'Wispra Settings, Account tab, with the backup AI card for Cloudflare Workers AI filled in.',
  },
  {
    version: '0.6.4',
    date: '2026-10-03',
    title: 'Clear messages when the AI reaches its daily limit',
    fixed: [
      'Daily limits are now called daily limits. When your AI key has used its allowance for the day, the Mind map, topics, Summary and posts stop straight away and say so, with how much was used and when it resets, instead of waiting forever.',
      'A per-minute limit is still waited out and the request is sent again, as before.',
      'Summary now also waits out the per-minute limit, and explains why if it has to stop.',
    ],
    imageAlt: 'A meeting\'s Mind map tab explaining that the AI provider\'s daily limit is reached, with a Continue button.',
  },
  {
    version: '0.6.3',
    date: '2026-10-03',
    title: 'Meeting transcripts in four columns',
    summary: 'See who spoke, about what, and what needs doing, side by side.',
    new: [
      'Transcript in four columns: time and speaker, topic, what was said, and action items. Topics cover the whole recording and action items sit next to the topic they came up in. Switch to a single list of action items any time, and click one to jump to where it was said.',
      'Speaker names. Names said in the recording ("I\'m Linh", "over to Sam") label the paragraphs they speak, and in "Both" mode paragraphs are marked You or Others. Click a label to rename a speaker everywhere. No voice recognition, and nothing about anyone\'s voice is stored.',
      'Choose where transcription and AI run: Wispra Cloud or your own Groq API key, under Settings → Account. Switching never deletes a saved key.',
    ],
    improved: [
      'Mind map, website and social posts are created only when you press the button, not every time you open the tab.',
      'Posts wait out the AI provider\'s per-minute limit and try again, and the tab tells you it is waiting.',
      'The window opens wider so all four columns fit; narrower windows fold them neatly.',
    ],
    fixed: ['Transcribing a file with Wispra Cloud now works when you are signed in.'],
    imageAlt: 'A finished meeting\'s Transcript tab with four columns: time and speaker, topic, transcript and action items.',
  },
  {
    version: '0.6.2',
    date: '2026-10-02',
    title: 'Mind maps finish even when the AI stumbles',
    fixed: [
      'A mind map could stop part-way with "The AI provider refused the request". Wispra now asks again, asks differently, or splits the part in two, so the map gets finished.',
      'If a part still can\'t be used, the message says so plainly, the finished parts are kept, and Continue picks up from where it stopped.',
    ],
    imageAlt: 'A Mind map tab keeping the finished parts and offering Continue after one part could not be used.',
  },
  {
    version: '0.6.1',
    date: '2026-10-02',
    title: 'Mind maps of long meetings build in the background',
    fixed: [
      'A mind map of a long recording could spin forever. It is now built in the background: it waits for the AI provider\'s limit, keeps every finished part, and continues after an error or after Wispra was closed. Keep working while it runs.',
      'The tab shows real progress ("5 of 9 parts done"), and a small mark in the recording list shows whether a map is being built, ready or unfinished.',
    ],
    improved: [
      'Wispra Cloud explains clearly when this month\'s AI allowance is used up: how much was used, when it resets and what you can do.',
      'Dictation keeps working when the allowance is used up: your words are typed as heard, without the AI cleanup.',
      'A chat question that could not be answered goes back into the box, so you can send it again later.',
    ],
    imageAlt: 'A Mind map being built, showing "5 of 9 parts done", with status marks on the recordings list.',
  },
  {
    version: '0.6.0',
    date: '2026-10-02',
    title: 'Mind maps for your meetings',
    summary: 'Turn any finished recording into a clickable map of what was discussed.',
    new: [
      'Mind map. A finished recording gets a Mind map tab next to Summary. Long meetings are outlined part by part, so nothing in the middle is skipped. Click a point and "Show in transcript" to jump to that moment. Export as an image or copy as an outline.',
      'Cloud sync (optional, off by default). Keep a copy of your History, Meetings and learned words in your Wispra account.',
      'Connect your AI assistant. A private, read-only link lets ChatGPT, Claude and other assistants read your synced dictations and meetings. You can set an expiry and change the link at any time.',
    ],
    improved: [
      'Summaries of long meetings are much more thorough, with one section per topic.',
      'The window opens wider so a meeting\'s tabs fit on one line.',
    ],
    fixed: [
      'A website or social post that failed no longer retries over and over; it shows the error and a Try again button.',
      'The garbled-text filter no longer drops a whole sentence when only part of it is unclear.',
    ],
    imageAlt: 'A meeting\'s Mind map tab with branches around the central topic.',
  },
  {
    version: '0.5.1',
    date: '2026-09-30',
    title: 'AI cleanup keeps every word you said',
    fixed: [
      'AI cleanup could sometimes shorten a long dictation and drop details. It now never summarizes or merges your sentences, and if the result looks too short Wispra types your original words instead.',
    ],
    imageAlt: 'Dictation history showing a long dictation kept in full after AI cleanup.',
  },
  {
    version: '0.5.0',
    date: '2026-09-29',
    title: 'Wispra learns your words on its own',
    new: [
      'Auto-learned vocabulary. Wispra picks up names and terms you use often from your History and Meetings and uses them to hear you better. Review or remove them under Settings → Learned.',
    ],
    fixed: ['Fixed occasional garbled transcriptions made of letter or syllable fragments instead of real words.'],
    imageAlt: 'Settings, Learned tab, listing terms Wispra picked up automatically.',
  },
  {
    version: '0.4.0',
    date: '2026-09-20',
    title: 'Wispra now learns from your corrections',
    summary: 'A new Learned tab builds a personal memory of your words and writing style. Nothing is applied without you.',
    new: [
      'Your words: fix a misheard word once and the AI cleanup gets a hint; fix it again and it is corrected automatically. Pin, switch off or delete any entry.',
      'Suggestions: Wispra spots recurring mishearings and names in your History and meetings and suggests them. Accept or ignore with one click.',
      'Writing style: habits from your own fixes, plus your notes, guide the AI cleanup.',
      'A private scorecard shows whether learning is helping. One switch turns learning off entirely.',
    ],
    fixed: ['A development build of Wispra can no longer change the installed app\'s "Launch at login" setting.'],
    imageAlt: 'Settings, Learned tab, with Your words, Suggestions and Writing style.',
  },
  {
    version: '0.3.1',
    date: '2026-09-20',
    title: 'No more phantom text from silent recordings',
    fixed: [
      'Recording without speaking no longer types stray phrases. You get a "No speech detected" notice, nothing is typed, and no transcription allowance is used.',
      'Meetings: silent stretches no longer create empty transcript lines, and auto-stop on silence works again.',
      'Stronger filtering of text the speech model invents on near-silent audio, including Vietnamese.',
    ],
    imageAlt: 'The floating microphone with a "No speech detected" notice.',
  },
  {
    version: '0.3.0',
    date: '2026-09-15',
    title: 'Ask questions about your meetings',
    new: [
      'Meeting chat. Ask anything about a meeting\'s transcript, live or afterwards, and the answer highlights the part of the transcript it came from. Each session keeps its chat history.',
    ],
    improved: ['The meeting view is wider and no longer shows a stray horizontal scrollbar.'],
    fixed: ['Fixed an error that could make the meeting chat fail on long transcripts.', 'Fixed "Launch at login" not sticking in some cases.'],
    imageAlt: 'A meeting session with the AI chat panel, the answer highlighting part of the transcript.',
  },
  {
    version: '0.2.6',
    date: '2026-06-24',
    title: 'Recording no longer stops while you are talking',
    fixed: [
      'Recording now starts when you press the hotkey or click the icon and stops only when you do it again. Auto-stop on silence is off, and one recording can last up to 10 minutes.',
    ],
    imageAlt: 'Settings showing the Toggle recording mode and a 10-minute maximum recording length.',
  },
  {
    version: '0.2.5',
    date: '2026-06-24',
    title: 'Fewer phantom phrases, better capitals',
    fixed: [
      'Phrases the speech model sometimes invents from background noise, like "like, share and subscribe", are now discarded.',
      'Natural pauses between sentences no longer end the recording too early.',
      'Every sentence and every name now starts with a capital letter, in Vietnamese and all other languages.',
    ],
    imageAlt: 'Dictation history with properly capitalized sentences in English and Vietnamese.',
  },
  {
    version: '0.2.4',
    date: '2026-06-17',
    title: 'Text lands in the right window, every time',
    fixed: [
      'With several monitors, text is now pasted into the window you clicked, not the previous one.',
      'The floating icon no longer disappears after long use or when a full-screen app opens.',
      'Wispra Cloud now filters out phantom phrases on silence, just like your own key does.',
    ],
    imageAlt: 'The floating microphone over an app window where dictated text was just pasted.',
  },
  {
    version: '0.2.3',
    date: '2026-06-16',
    title: 'Better punctuation',
    improved: ['The AI cleanup now adds commas between clauses and full stops at the end of sentences more reliably.'],
    fixed: [
      'Fixed random invented text appearing during silence.',
      'The Updates section now shows which version you have ("You are up to date — v0.2.3").',
    ],
    imageAlt: 'Settings, Updates section saying "You are up to date — v0.2.3".',
  },
  {
    version: '0.2.2',
    date: '2026-06-16',
    title: 'Smoother Vietnamese and long dictations',
    improved: [
      'AI cleanup now runs correctly when the language is set to Vietnamese.',
      'Long dictations without pauses are split more sensibly for the AI cleanup.',
      'Silence at the end of a recording is trimmed before transcription.',
      'Fixed AI cleanup when using a proxy provider.',
    ],
    imageAlt: 'Settings with the language set to Vietnamese and AI cleanup switched on.',
  },
  {
    version: '0.2.1',
    date: '2026-06-15',
    title: 'Hotkey works right after Windows starts',
    fixed: [
      'Some apps grab hotkeys while Windows is starting. Wispra now quietly tries again a few seconds later, so your hotkey works when Wispra launches at login.',
      'If the floating icon\'s window crashes, Wispra now recreates it the next time you press the hotkey.',
    ],
    imageAlt: 'Settings showing the Ctrl + Shift + Space hotkey and Launch at login switched on.',
  },
  {
    version: '0.2.0',
    date: '2026-06-14',
    title: 'A smarter History',
    summary: 'Find past dictations by day or topic, see how much time you saved, and let Wispra pick the right tone for each app.',
    new: [
      'History by day and by topic: filter by Today, Yesterday, This week and more, or by topics like #Email and #Meeting.',
      'Summarize with AI: a bullet-point summary of everything you dictated on a topic.',
      'Time saved: see how many hours you saved compared with typing.',
      'Smart tone: Vietnamese speech and apps like email or chat get the matching cleanup automatically.',
      'Voice commands for punctuation ("new paragraph", "comma"…), text snippets, undo by saying "delete that", usage statistics and history export.',
    ],
    improved: [
      'AI cleanup is now on by default.',
      'Sound cues work even when Windows sounds are muted, and the floating icon no longer gets cut off at screen edges.',
      'Settings opens automatically after you install.',
    ],
    imageAlt: 'Dictation history with the time-saved banner, day filters and topic hashtags.',
  },
  {
    version: '0.1.9',
    date: '2026-06-14',
    title: 'Modes, custom words and file transcription',
    new: [
      'Modes: choose how the AI cleans up your speech — General, Professional, Vietnamese, Casual, or your own. Switch from the tray menu.',
      'Custom vocabulary: names and terms the AI cleanup must spell exactly.',
      'Transcribe tab: drop in an audio or video file and get a transcript.',
      'Local mode: use your own local AI server, no API key needed.',
    ],
    improved: ['The floating icon shows the active mode while recording.', 'Casual mode keeps your natural, conversational phrasing.'],
    imageAlt: 'Settings, Modes: General, Professional, Vietnamese, Casual and a custom mode.',
  },
  {
    version: '0.1.8',
    date: '2026-06-13',
    title: 'A fresh new Settings window',
    improved: [
      'Settings redesigned with switches, provider cards and smooth animations.',
      'Your hotkey is shown as key badges (Ctrl + Shift + Space).',
      'A progress bar while an update downloads.',
    ],
    imageAlt: 'The redesigned Settings window with provider cards, switches and hotkey badges.',
  },
  {
    version: '0.1.7',
    date: '2026-06-13',
    title: 'Correct Vietnamese accents after AI cleanup',
    fixed: [
      'The AI cleanup now keeps Vietnamese accents intact.',
      'If the cleaned-up text is very different in length from what you said, Wispra types your original words instead.',
    ],
    imageAlt: 'Dictation history showing a Vietnamese dictation with correct accents after AI cleanup.',
  },
  {
    version: '0.1.6',
    date: '2026-06-13',
    title: 'AI cleanup',
    new: ['Optional AI cleanup fixes spelling and adds punctuation after transcription, using your own key. Turn it on in Settings → General.'],
    imageAlt: 'Settings, General, with the new AI cleanup switch.',
  },
  {
    version: '0.1.5',
    date: '2026-06-13',
    title: 'Know when an update is installed',
    improved: ['After an update installs, Wispra opens Settings and tells you it was updated.'],
    imageAlt: 'A notification saying Wispra was updated to v0.1.5, with Settings open.',
  },
  {
    version: '0.1.4',
    date: '2026-06-13',
    title: 'Automatic update check',
    improved: ['Wispra checks for updates a few seconds after it starts, and update dialogs always appear on top.'],
    imageAlt: 'An update dialog shown on top after the startup check.',
  },
  {
    version: '0.1.3',
    date: '2026-06-13',
    title: 'Restart to finish updating',
    improved: ['When an update is ready, a Windows notification and a dialog ask you to restart.'],
    imageAlt: 'A Windows notification saying an update is ready and asking to restart.',
  },
  {
    version: '0.1.2',
    date: '2026-06-13',
    title: 'Update prompts',
    new: ['Wispra now tells you when a new version is available and asks to restart once it has downloaded.'],
    imageAlt: 'A dialog saying a new version of Wispra is available.',
  },
  {
    version: '0.1.1',
    date: '2026-06-12',
    title: 'No more jumping windows',
    fixed: ['The window you dictate into no longer resizes when it is maximized.'],
    imageAlt: 'Dictated text typed into a maximized email window.',
  },
  {
    version: '0.1.0',
    date: '2026-06-12',
    title: 'Hello, Wispra',
    summary: 'Press one key, speak, and your words are typed into any app on Windows.',
    new: [
      'System-wide voice dictation with a global hotkey.',
      'Fast transcription with Groq, typed straight into the app you are using.',
      'A floating microphone, a tray menu, and Settings for your API key, hotkey, language and launch at login.',
      'A history of your dictations with a copy button.',
    ],
    imageAlt: 'The floating microphone recording over a document while the text appears.',
  },
]

export const LATEST = RELEASES[0]

export function findRelease(version: string): Release | undefined {
  return RELEASES.find(r => r.version === version)
}

/** e.g. 'Oct 3, 2026' — fixed to UTC so the server and browser agree. */
export function formatReleaseDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export function releaseImage(version: string): string {
  return `/updates/${version}.webp`
}
