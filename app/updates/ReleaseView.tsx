import Image from 'next/image'
import Link from 'next/link'
import { LATEST, RELEASES, formatReleaseDate, releaseImage, type Release } from './releases'
import { LatestBadge } from './VersionNav'

const SECTIONS = [
  { key: 'new', label: 'New', dot: 'bg-brand', text: 'text-[#8EA2FF]' },
  { key: 'improved', label: 'Improved', dot: 'bg-[#A78BFA]', text: 'text-[#C4B5FD]' },
  { key: 'fixed', label: 'Fixed', dot: 'bg-[#27C93F]', text: 'text-[#3DDC5A]' },
] as const

const hrefFor = (r: Release) => (r === LATEST ? '/updates' : `/updates/${r.version}`)

export default function ReleaseView({ release }: { release: Release }) {
  const index = RELEASES.indexOf(release)
  const newer = index > 0 ? RELEASES[index - 1] : undefined
  const older = index < RELEASES.length - 1 ? RELEASES[index + 1] : undefined

  return (
    <article>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
        <span className="font-mono font-semibold text-text-primary">v{release.version}</span>
        {release === LATEST && <LatestBadge />}
        <time dateTime={release.date} className="text-text-muted">{formatReleaseDate(release.date)}</time>
      </div>

      <h2 className="mt-3 text-2xl sm:text-3xl font-bold tracking-tight text-text-primary text-balance">{release.title}</h2>
      {release.summary && <p className="mt-3 text-base sm:text-lg text-text-muted leading-relaxed">{release.summary}</p>}

      <figure className="mt-6 sm:mt-8">
        <div className="relative rounded-xl sm:rounded-2xl border border-white/10 bg-bg-card p-1.5 sm:p-2 shadow-2xl shadow-brand/5">
          <Image
            key={release.version}
            src={releaseImage(release.version)}
            alt={release.imageAlt}
            width={1600}
            height={1000}
            priority
            unoptimized
            className="w-full h-auto rounded-lg sm:rounded-xl"
          />
        </div>
        <figcaption className="mt-2.5 text-xs text-text-muted text-center">
          Wispra v{release.version}. Screenshot with sample content.
        </figcaption>
      </figure>

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
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
      </div>

      <nav aria-label="Other versions" className="mt-12 grid grid-cols-2 gap-3 border-t border-white/5 pt-6">
        {older ? (
          <Link href={hrefFor(older)} className="group rounded-xl border border-white/5 bg-bg-card p-4 hover:border-white/15 transition-colors">
            <span className="block text-xs text-text-muted">← Older</span>
            <span className="mt-1 block text-sm font-semibold text-text-primary">v{older.version}</span>
          </Link>
        ) : (
          <span />
        )}
        {newer ? (
          <Link href={hrefFor(newer)} className="group rounded-xl border border-white/5 bg-bg-card p-4 text-right hover:border-white/15 transition-colors">
            <span className="block text-xs text-text-muted">Newer →</span>
            <span className="mt-1 block text-sm font-semibold text-text-primary">v{newer.version}</span>
          </Link>
        ) : (
          <span />
        )}
      </nav>
    </article>
  )
}
