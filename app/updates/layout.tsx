import type { Metadata } from 'next'
import Link from 'next/link'
import { MicIcon } from '../icons'
import { LATEST } from './releases'
import VersionNav from './VersionNav'

export const metadata: Metadata = {
  title: 'Updates — Wispra',
  description: 'What is new in each version of Wispra, with screenshots.',
}

const GITHUB_URL = 'https://github.com/sinhgiang/wispra'

export default function UpdatesLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-30 border-b border-white/5 bg-bg-base/80 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2 shrink-0">
            <div className="w-7 h-7 rounded-lg bg-brand flex items-center justify-center">
              <MicIcon className="w-4 h-4 text-white" />
            </div>
            <span className="font-semibold text-text-primary">Wispra</span>
          </Link>
          <a
            href={`${GITHUB_URL}/releases/latest`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium px-4 py-1.5 rounded-lg bg-brand hover:bg-brand-dark text-white transition-colors"
          >
            Download v{LATEST.version}
          </a>
        </div>
      </header>

      <div className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 pt-8 sm:pt-12 pb-16">
        <div className="mb-6 sm:mb-10">
          <p className="text-xs font-semibold uppercase tracking-widest text-brand mb-2">Updates</p>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-text-primary">What&apos;s new in Wispra</h1>
          <p className="mt-2 text-text-muted">Every version, what changed, and how it looks.</p>
        </div>

        <div className="lg:grid lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-10">
          <VersionNav />
          <main className="min-w-0">{children}</main>
        </div>
      </div>

      <footer className="border-t border-white/5 py-8">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-text-muted">
          <Link href="/" className="hover:text-text-primary transition-colors">← Back to wispra</Link>
          <a href={`${GITHUB_URL}/releases`} target="_blank" rel="noopener noreferrer" className="hover:text-text-primary transition-colors">
            Downloads on GitHub
          </a>
        </div>
      </footer>
    </div>
  )
}
