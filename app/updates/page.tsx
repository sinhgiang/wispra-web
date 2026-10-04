import { getUpdates } from './data'
import ReleaseView from './ReleaseView'

// Re-read the releases on GitHub at most once an hour.
export const revalidate = 3600

export default async function UpdatesPage() {
  const releases = await getUpdates()
  return <ReleaseView release={releases[0]} releases={releases} />
}
