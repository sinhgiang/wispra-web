import { LATEST } from './releases'
import ReleaseView from './ReleaseView'

export default function UpdatesPage() {
  return <ReleaseView release={LATEST} />
}
