import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { IPHONE_RELEASES, LATEST_IPHONE, findIphoneRelease } from '../../iphone'
import ReleaseView from '../../ReleaseView'

type Props = { params: Promise<{ build: string }> }

// Only the builds listed in app/updates/iphone.ts exist; anything else is a 404.
export const dynamicParams = false

export function generateStaticParams() {
  return IPHONE_RELEASES.map(r => ({ build: r.version }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const release = findIphoneRelease((await params).build)
  if (!release) return {}
  return { title: `${release.title} — Updates`, description: release.summary ?? release.title }
}

export default async function IphoneBuildPage({ params }: Props) {
  const release = findIphoneRelease((await params).build)
  if (!release) notFound()
  // The latest build lives at /updates/iphone.
  if (release === LATEST_IPHONE) redirect('/updates/iphone')
  return <ReleaseView release={release} releases={IPHONE_RELEASES} track="iphone" />
}
