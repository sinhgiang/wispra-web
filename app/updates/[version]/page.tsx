import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { RELEASES } from '../releases'
import { getUpdates } from '../data'
import ReleaseView from '../ReleaseView'

type Props = { params: Promise<{ version: string }> }

// Versions kept in the repo are built ahead; a newer one published on GitHub is
// built the first time someone opens it, then kept and re-checked hourly.
export const revalidate = 3600
export const dynamicParams = true

export function generateStaticParams() {
  return RELEASES.map(r => ({ version: r.version }))
}

async function find(version: string) {
  const releases = await getUpdates()
  return { releases, release: releases.find(r => r.version === version) }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { release } = await find((await params).version)
  if (!release) return {}
  return {
    title: `Wispra v${release.version}: ${release.title}`,
    description: release.summary ?? release.title,
  }
}

export default async function VersionPage({ params }: Props) {
  const { releases, release } = await find((await params).version)
  if (!release) notFound()
  // The latest version lives at /updates.
  if (release.version === releases[0].version) redirect('/updates')
  return <ReleaseView release={release} releases={releases} />
}
