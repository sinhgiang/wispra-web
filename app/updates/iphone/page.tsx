import type { Metadata } from 'next'
import { IPHONE_RELEASES, LATEST_IPHONE } from '../iphone'
import ReleaseView from '../ReleaseView'

export const metadata: Metadata = {
  title: 'Wispra for iPhone — Updates',
  description: 'What is new in each build of Wispra for iPhone.',
}

export default function IphoneUpdatesPage() {
  return <ReleaseView release={LATEST_IPHONE} releases={IPHONE_RELEASES} track="iphone" />
}
