import HomePage from './HomePage'
import { getLatestRelease } from '@/lib/latest-release'

// Re-check GitHub for a newer Wispra release at most once an hour.
export const revalidate = 3600

export default async function Page() {
  return <HomePage release={await getLatestRelease()} />
}
