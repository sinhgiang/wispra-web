import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { LATEST, RELEASES, findRelease } from '../releases'
import ReleaseView from '../ReleaseView'

type Props = { params: Promise<{ version: string }> }

// Only the versions listed in releases.ts exist; anything else is a 404.
export const dynamicParams = false

export function generateStaticParams() {
  return RELEASES.map(r => ({ version: r.version }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const release = findRelease((await params).version)
  if (!release) return {}
  return {
    title: `Wispra v${release.version}: ${release.title}`,
    description: release.summary ?? release.title,
  }
}

export default async function VersionPage({ params }: Props) {
  const release = findRelease((await params).version)
  if (!release) notFound()
  // The latest version lives at /updates.
  if (release === LATEST) redirect('/updates')
  return <ReleaseView release={release} />
}
