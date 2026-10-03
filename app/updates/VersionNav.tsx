'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LATEST, RELEASES, formatReleaseDate } from './releases'

/** Which version the current URL shows: /updates is the latest one. */
function activeVersion(pathname: string): string {
  const match = pathname.match(/^\/updates\/([^/]+)/)
  return match ? decodeURIComponent(match[1]) : LATEST.version
}

/**
 * The list of versions. A sticky column on large screens; a row of chips that
 * scrolls sideways on phones and tablets. Lives in the layout, so it keeps its
 * scroll position while you click through versions.
 */
export default function VersionNav() {
  const active = activeVersion(usePathname())
  const chipsRef = useRef<HTMLDivElement>(null)

  // Keep the selected chip in view on small screens.
  useEffect(() => {
    const chip = chipsRef.current?.querySelector<HTMLElement>('[aria-current="page"]')
    chip?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [active])

  return (
    <nav aria-label="Versions" className="mb-6 lg:mb-0">
      {/* Phones and tablets: sideways chips */}
      <div
        ref={chipsRef}
        className="lg:hidden -mx-4 sm:-mx-6 px-4 sm:px-6 flex gap-2 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {RELEASES.map(r => {
          const isActive = r.version === active
          return (
            <Link
              key={r.version}
              href={r === LATEST ? '/updates' : `/updates/${r.version}`}
              aria-current={isActive ? 'page' : undefined}
              className={`shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${
                isActive
                  ? 'border-brand bg-brand text-white'
                  : 'border-white/10 bg-bg-card text-text-muted hover:text-text-primary'
              }`}
            >
              v{r.version}
              {r === LATEST && <span className={`ml-1.5 text-[11px] ${isActive ? 'text-white/80' : 'text-[#27C93F]'}`}>Latest</span>}
            </Link>
          )
        })}
      </div>

      {/* Large screens: sticky column */}
      <div className="hidden lg:block sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto pr-2 -mr-2">
        <ul className="space-y-0.5 border-l border-white/5">
          {RELEASES.map(r => {
            const isActive = r.version === active
            return (
              <li key={r.version}>
                <Link
                  href={r === LATEST ? '/updates' : `/updates/${r.version}`}
                  aria-current={isActive ? 'page' : undefined}
                  className={`group -ml-px flex items-center justify-between gap-3 border-l-2 py-2 pl-4 pr-2 rounded-r-lg transition-colors ${
                    isActive
                      ? 'border-brand bg-brand/10'
                      : 'border-transparent hover:border-white/20 hover:bg-white/[0.03]'
                  }`}
                >
                  <span className="min-w-0">
                    <span className={`block text-sm font-semibold ${isActive ? 'text-text-primary' : 'text-text-primary/80 group-hover:text-text-primary'}`}>
                      v{r.version}
                    </span>
                    <span className="block text-xs text-text-muted">{formatReleaseDate(r.date)}</span>
                  </span>
                  {r === LATEST && <LatestBadge />}
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
