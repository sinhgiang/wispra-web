'use client'
import { useEffect, useState } from 'react'

type Status = 'loading' | 'success' | 'error'

export default function AuthCallbackPage(): React.JSX.Element {
  const [status, setStatus] = useState<Status>('loading')

  useEffect(() => {
    const hash = window.location.hash // #access_token=...&refresh_token=...
    if (!hash || !hash.includes('access_token')) {
      setStatus('error')
      return
    }

    // Forward tokens to the Electron app via wispra:// custom protocol.
    // Use an anchor click so the browser does NOT enter a navigation/loading state.
    const a = document.createElement('a')
    a.href = `wispra://auth${hash}`
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)

    // Show success immediately
    setStatus('success')

    // Attempt to close this tab. Works when Chrome opened this as a new window
    // (e.g. no existing Chrome window was open). If blocked, user sees the success page.
    setTimeout(() => window.close(), 800)
  }, [])

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: "'Inter', system-ui, sans-serif",
      background: '#07070F',
      color: '#EEEEF5',
      gap: '18px',
    }}>
      <Logo />

      {status === 'loading' && (
        <p style={{ fontSize: '15px', color: '#888', margin: 0 }}>Signing you in…</p>
      )}

      {status === 'success' && (
        <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <p style={{ fontSize: '20px', fontWeight: 700, margin: 0 }}>✓ You&apos;re signed in!</p>
          <p style={{ fontSize: '14px', color: '#666', margin: 0 }}>
            You can close this tab and return to Wispra.
          </p>
          <button
            onClick={() => window.close()}
            style={{
              marginTop: '8px',
              padding: '8px 20px',
              background: '#4F6EF7',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              fontSize: '14px',
              cursor: 'pointer',
              fontWeight: 500,
            }}
          >
            Close this tab
          </button>
        </div>
      )}

      {status === 'error' && (
        <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <p style={{ fontSize: '18px', fontWeight: 600, margin: 0, color: '#f87171' }}>
            Sign-in failed
          </p>
          <p style={{ fontSize: '14px', color: '#666', margin: 0 }}>
            Please close this tab and try again from Wispra.
          </p>
        </div>
      )}
    </div>
  )
}

function Logo(): React.JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
      <div style={{
        width: 44, height: 44, borderRadius: 11,
        background: '#4F6EF7',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>
        <svg width="20" height="22" viewBox="0 0 14 16" fill="none">
          <rect x="4" y="0.5" width="6" height="9" rx="3" fill="white" />
          <path d="M1.5 8C1.5 11.038 4.014 13 7 13C9.986 13 12.5 11.038 12.5 8"
            stroke="white" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="7" y1="13" x2="7" y2="15.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="4" y1="15.5" x2="10" y2="15.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </div>
      <span style={{ fontSize: '22px', fontWeight: 700, letterSpacing: '-0.3px' }}>Wispra</span>
    </div>
  )
}
