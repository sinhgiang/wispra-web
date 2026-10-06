import Link from 'next/link'
import { formatReleaseDate } from './releases'
import type { UpdateEntry } from './data'
import { hrefFor, versionLabel, type Track } from './links'
import type { PhoneScreen } from './iphone'
import { LatestBadge } from './VersionNav'

const SECTIONS = [
  { key: 'new', label: 'New', dot: 'bg-brand', text: 'text-[#8EA2FF]' },
  { key: 'improved', label: 'Improved', dot: 'bg-[#A78BFA]', text: 'text-[#C4B5FD]' },
  { key: 'fixed', label: 'Fixed', dot: 'bg-[#27C93F]', text: 'text-[#3DDC5A]' },
  { key: 'notes', label: 'Good to know', dot: 'bg-white/40', text: 'text-text-muted' },
] as const

/** Release notes from GitHub may use **bold** and `code`; everything else is plain text. */
function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*|`[^`]+`)/).map((part, i) => {
        if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={i} className="font-semibold text-text-primary">{part.slice(2, -2)}</strong>
        if (/^`[^`]+`$/.test(part)) return <code key={i} className="rounded bg-white/5 px-1 py-0.5 text-[0.9em]">{part.slice(1, -1)}</code>
        return part
      })}
    </>
  )
}

/** Grid width by number of screens, written out so Tailwind keeps the classes. */
const SCREEN_GRID: Record<number, string> = {
  1: 'grid-cols-1 max-w-[240px] mx-auto',
  2: 'grid-cols-2 max-w-[500px] mx-auto',
  3: 'grid-cols-3',
}

/** Phone screenshots side by side; a screen without an image shows where it will go. */
function PhoneScreens({ screens, label }: { screens: PhoneScreen[]; label: string }) {
  return (
    <figure className="mt-6 sm:mt-8">
      <div className={`grid gap-2 sm:gap-5 ${SCREEN_GRID[Math.min(screens.length, 3)] ?? SCREEN_GRID[3]}`}>
        {screens.map(screen => (
          <div key={screen.caption} className="mx-auto w-full max-w-[240px] min-w-0">
            <div className="rounded-[1.25rem] sm:rounded-[2rem] border border-white/10 bg-bg-card p-1 sm:p-2 shadow-2xl shadow-brand/5">
              {screen.src ? (
                <img src={screen.src} alt={screen.caption} width={1179} height={2556} decoding="async" className="w-full h-auto rounded-[1rem] sm:rounded-[1.5rem]" />
              ) : (
                <div className="flex aspect-[1179/2556] flex-col items-center justify-center gap-2 rounded-[1rem] sm:rounded-[1.5rem] border border-dashed border-white/15 bg-white/[0.02] px-1.5 sm:px-4 text-center">
                  <span className="text-[9px] sm:text-xs font-semibold uppercase tracking-wider sm:tracking-widest text-text-muted">Screenshot coming soon</span>
                </div>
              )}
            </div>
            <p className="mt-2 text-center text-[11px] sm:text-xs leading-snug text-text-muted">{screen.caption}</p>
          </div>
        ))}
      </div>
      <figcaption className="mt-3 text-xs text-text-muted text-center">{label}. Screenshots with sample content.</figcaption>
    </figure>
  )
}

export default function ReleaseView({
  release,
  releases,
  track = 'desktop',
}: {
  release: UpdateEntry & { screens?: PhoneScreen[] }
  releases: UpdateEntry[]
  track?: Track
}) {
  const latest = releases[0]
  const index = releases.findIndex(r => r.version === release.version)
  const newer = index > 0 ? releases[index - 1] : undefined
  const older = index >= 0 && index < releases.length - 1 ? releases[index + 1] : undefined

  return (
    <article>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
        <span className="font-mono font-semibold text-text-primary">{versionLabel(release.version, track)}</span>
        {release.version === latest.version && <LatestBadge />}
        <time dateTime={release.date} className="text-text-muted">{formatReleaseDate(release.date)}</time>
      </div>

      <h2 className="mt-3 text-2xl sm:text-3xl font-bold tracking-tight text-text-primary text-balance">{release.title}</h2>
      {release.summary && (
        <p className="mt-3 text-base sm:text-lg text-text-muted leading-relaxed"><Inline text={release.summary} /></p>
      )}

      {release.screens && (
        <PhoneScreens screens={release.screens} label={`Wispra for iPhone, ${versionLabel(release.version, track).toLowerCase()}`} />
      )}

      {!release.screens && release.image && (
        <figure className="mt-6 sm:mt-8">
          <div className="relative rounded-xl sm:rounded-2xl border border-white/10 bg-bg-card p-1.5 sm:p-2 shadow-2xl shadow-brand/5">
            {/* Plain <img>: repo images are already optimized WebP; GitHub screenshots are served by GitHub. */}
            <img
              key={release.version}
              src={release.image}
              alt={release.imageAlt}
              width={1600}
              height={1000}
              decoding="async"
              className="w-full h-auto rounded-lg sm:rounded-xl"
            />
          </div>
          <figcaption className="mt-2.5 text-xs text-text-muted text-center">
            Wispra v{release.version}. Screenshot with sample content.
          </figcaption>
        </figure>
      )}

      <div className="mt-8 sm:mt-10 space-y-8">
        {SECTIONS.map(({ key, label, dot, text }) => {
          const items = release[key]
          if (!items?.length) return null
          return (
            <section key={key}>
              <h3 className={`flex items-center gap-2 text-xs font-semibold uppercase tracking-widest ${text}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
                {label}
              </h3>
              <ul className="mt-3 space-y-3">
                {items.map(item => (
                  <li key={item} className="flex gap-3 text-[15px] leading-relaxed text-text-primary/90">
                    <span className="mt-2.5 h-1 w-1 shrink-0 rounded-full bg-white/30" />
                    <span><Inline text={item} /></span>
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
      </div>

      <nav aria-label="Other versions" className="mt-12 grid grid-cols-2 gap-3 border-t border-white/5 pt-6">
        {older ? (
          <Link href={hrefFor(older.version, latest.version, track)} className="group rounded-xl border border-white/5 bg-bg-card p-4 hover:border-white/15 transition-colors">
            <span className="block text-xs text-text-muted">← Older</span>
            <span className="mt-1 block text-sm font-semibold text-text-primary">{versionLabel(older.version, track)}</span>
          </Link>
        ) : (
          <span />
        )}
        {newer ? (
          <Link href={hrefFor(newer.version, latest.version, track)} className="group rounded-xl border border-white/5 bg-bg-card p-4 text-right hover:border-white/15 transition-colors">
            <span className="block text-xs text-text-muted">Newer →</span>
            <span className="mt-1 block text-sm font-semibold text-text-primary">{versionLabel(newer.version, track)}</span>
          </Link>
        ) : (
          <span />
        )}
      </nav>
    </article>
  )
}
