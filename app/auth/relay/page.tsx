'use client'
import { useEffect } from 'react'

// Tiny invisible relay page — opened as a popup by /auth/callback.
// Fires the wispra:// protocol to deliver tokens to Electron, then closes itself.
// window.close() works here because this window was opened via window.open().
export default function AuthRelayPage(): React.JSX.Element {
  useEffect(() => {
    const hash = window.location.hash
    if (hash.includes('access_token')) {
      const a = document.createElement('a')
      a.href = `wispra://auth${hash}`
      a.style.display = 'none'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    }
    // Close this popup — always works because it was opened by window.open()
    setTimeout(() => window.close(), 300)
  }, [])

  return <div style={{ background: '#07070F', minHeight: '100vh' }} />
}
