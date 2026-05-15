'use client'

import { useEffect, useState } from 'react'

const DISMISS_KEY = 'bat-ios-install-dismissed'

export default function IOSInstallBanner() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return

    const ua = window.navigator.userAgent
    const isIOS =
      /iPad|iPhone|iPod/.test(ua) &&
      !(window as Window & { MSStream?: unknown }).MSStream
    const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua)
    const isStandalone =
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true ||
      window.matchMedia('(display-mode: standalone)').matches

    if (!isIOS || !isSafari || isStandalone) return
    if (localStorage.getItem(DISMISS_KEY)) return

    const t = setTimeout(() => setShow(true), 1500)
    return () => clearTimeout(t)
  }, [])

  if (!show) return null

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, '1')
    setShow(false)
  }

  return (
    <div
      role="dialog"
      aria-label="Install app"
      style={{
        position: 'fixed',
        left: 12,
        right: 12,
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)',
        zIndex: 9999,
        background: 'var(--surface)',
        color: 'var(--fg)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        boxShadow: '0 6px 24px rgba(0,0,0,0.18)',
        padding: '12px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        fontSize: 14,
        lineHeight: 1.35,
      }}
    >
      <div style={{ flex: 1 }}>
        Install this app: tap{' '}
        <span aria-label="Share" style={{ display: 'inline-block', transform: 'translateY(2px)' }}>
          {/* iOS share glyph */}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M12 3v12M12 3l-4 4M12 3l4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>{' '}
        then <strong>Add to Home Screen</strong>.
      </div>
      <button
        onClick={dismiss}
        aria-label="Dismiss"
        style={{
          background: 'transparent',
          border: 'none',
          color: 'var(--muted)',
          fontSize: 20,
          cursor: 'pointer',
          padding: '4px 8px',
          lineHeight: 1,
        }}
      >
        ×
      </button>
    </div>
  )
}
