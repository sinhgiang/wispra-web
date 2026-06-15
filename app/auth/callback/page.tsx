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

    // Use a hidden anchor click instead of window.location.href
    // so the browser does NOT show a loading/navigation state
    const a = document.createElement('a')
    a.href = `wispra://auth${hash}`
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)

    // Show success right away, then attempt to close the tab
    setStatus('success')
    setTimeout(() => window.close(), 1200)
  }, [])

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'Inter, system-ui, sans-serif',
      background: '#07070F',
      color: '#EEEEF5',
      gap: '16px',
    }}>
      {status === 'loading' && (
        <>
          <WispraLogo />
          <p style={{ fontSize: '16px', opacity: 0.7, margin: 0 }}>Signing you in…</p>
        </>
      )}

      {status === 'success' && (
        <>
          <WispraLogo />
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontSize: '18px', fontWeight: 600, margin: '0 0 6px' }}>You&apos;re signed in!</p>
            <p style={{ fontSize: '14px', opacity: 0.6, margin: 0 }}>
              You can close this tab and return to Wispra.
            </p>
          </div>
        </>
      )}

      {status === 'error' && (
        <>
          <WispraLogo />
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontSize: '18px', fontWeight: 600, margin: '0 0 6px', color: '#f87171' }}>
              Sign-in failed
            </p>
            <p style={{ fontSize: '14px', opacity: 0.6, margin: 0 }}>
              Please close this tab and try again from Wispra.
            </p>
          </div>
        </>
      )}
    </div>
  )
}

function WispraLogo(): React.JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
      <div style={{
        width: 40, height: 40, borderRadius: 10,
        background: '#4F6EF7',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <svg width="20" height="22" viewBox="0 0 14 16" fill="none">
          <rect x="4" y="0.5" width="6" height="9" rx="3" fill="white" />
          <path d="M1.5 8C1.5 11.038 4.014 13 7 13C9.986 13 12.5 11.038 12.5 8"
            stroke="white" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="7" y1="13" x2="7" y2="15.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="4" y1="15.5" x2="10" y2="15.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </div>
      <span style={{ fontSize: '20px', fontWeight: 700, letterSpacing: '-0.3px' }}>Wispra</span>
    </div>
  )
}
