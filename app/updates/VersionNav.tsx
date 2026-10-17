'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { formatReleaseDate } from './releases'
import { hrefFor, trackOf, TRACK_BASE, TRACK_LABEL, versionLabel, type Track } from './links'

export interface NavItem {
  version: string
  date: string
}

/** Which version the current URL shows: a list's base URL is its latest entry. */
function activeVersion(pathname: string, latest: string, track: Track): string {
  const rest = pathname.slice(TRACK_BASE[track].length).replace(/^\//, '').split('/')[0]
  return rest ? decodeURIComponent(rest) : latest
}

/** Mac & Windows | iPhone. */
function TrackTabs({ track }: { track: Track }) {
  return (
    <div role="tablist" aria-label="Product" className="mb-4 inline-flex rounded-xl border border-white/10 bg-bg-card p-1 text-sm">
      {(['desktop', 'iphone'] as const).map(t => (
        <Link
          key={t}
          href={TRACK_BASE[t]}
          role="tab"
          aria-selected={t === track}
          className={`rounded-lg px-3 py-1.5 font-medium transition-colors ${
            t === track ? 'bg-brand text-white' : 'text-text-muted hover:text-text-primary'
          }`}
        >
          {TRACK_LABEL[t]}
        </Link>
      ))}
    </div>
  )
}

/**
 * The list of versions. A sticky column on large screens; a row of chips that
 * scrolls sideways on phones and tablets. Lives in the layout, so it keeps its
 * scroll position while you click through versions.
 */
export default function VersionNav({ lists }: { lists: Record<Track, NavItem[]> }) {
  const pathname = usePathname()
  const track = trackOf(pathname)
  const items = lists[track]
  const latest = items[0]?.version ?? ''
  const active = activeVersion(pathname, latest, track)
  const chipsRef = useRef<HTMLDivElement>(null)

  // Keep the selected chip in view on small screens.
  useEffect(() => {
    const chip = chipsRef.current?.querySelector<HTMLElement>('[aria-current="page"]')
    chip?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [active])

  return (
    <nav aria-label="Versions" className="mb-6 lg:mb-0">
      <TrackTabs track={track} />
      {/* Phones and tablets: sideways chips */}
      <div
        ref={chipsRef}
        className="lg:hidden -mx-4 sm:-mx-6 px-4 sm:px-6 flex gap-2 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {items.map(r => {
          const isActive = r.version === active
          const isLatest = r.version === latest
          return (
            <Link
              key={r.version}
              href={hrefFor(r.version, latest, track)}
              aria-current={isActive ? 'page' : undefined}
              className={`shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${
                isActive
                  ? 'border-brand bg-brand text-white'
                  : 'border-white/10 bg-bg-card text-text-muted hover:text-text-primary'
              }`}
            >
              {versionLabel(r.version, track)}
              {isLatest && <span className={`ml-1.5 text-[11px] ${isActive ? 'text-white/80' : 'text-[#27C93F]'}`}>Latest</span>}
            </Link>
          )
        })}
      </div>

      {/* Large screens: sticky column */}
      <div className="hidden lg:block sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto pr-2 -mr-2">
        <ul className="space-y-0.5 border-l border-white/5">
          {items.map(r => {
            const isActive = r.version === active
            return (
              <li key={r.version}>
                <Link
                  href={hrefFor(r.version, latest, track)}
                  aria-current={isActive ? 'page' : undefined}
                  className={`group -ml-px flex items-center justify-between gap-3 border-l-2 py-2 pl-4 pr-2 rounded-r-lg transition-colors ${
                    isActive
                      ? 'border-brand bg-brand/10'
                      : 'border-transparent hover:border-white/20 hover:bg-white/[0.03]'
                  }`}
                >
                  <span className="min-w-0">
                    <span className={`block text-sm font-semibold ${isActive ? 'text-text-primary' : 'text-text-primary/80 group-hover:text-text-primary'}`}>
                      {versionLabel(r.version, track)}
                    </span>
                    <span className="block text-xs text-text-muted">{formatReleaseDate(r.date)}</span>
                  </span>
                  {r.version === latest && <LatestBadge />}
                </Link>
              </li>
            )
          })}
        </ul>
      </div>
    </nav>
  )
}

export function LatestBadge() {
  return (
    <span className="shrink-0 rounded-full border border-[#27C93F]/30 bg-[#27C93F]/10 px-2 py-0.5 text-[11px] font-semibold text-[#3DDC5A]">
      Latest
    </span>
  )
}
