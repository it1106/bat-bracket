'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { lastSeenAnnouncement, markAnnouncementSeen } from '@/lib/announcements'
import { track } from '@/lib/analytics'

// The site owner's announcement, shown once per visitor as a modal they
// acknowledge. The text and its id come from /api/announcement; the id is
// derived from the text server-side, so editing the announcement on /bmstats
// gives it a new id and everyone sees it again.
//
// Every way of closing it counts as OK and is remembered — an Escape that
// didn't stick would leave the popup reappearing on every page load.

export default function AnnouncementPopup() {
  const pathname = usePathname()
  const [shown, setShown] = useState<{ id: string; text: string } | null>(null)
  const okRef = useRef<HTMLButtonElement | null>(null)

  // Not on /bmstats: the owner is editing the text there and shouldn't be
  // interrupted by their own announcement.
  const suppressed = (pathname ?? '').startsWith('/bmstats')

  useEffect(() => {
    if (suppressed) return
    let cancelled = false
    const seen = lastSeenAnnouncement()
    fetch('/api/announcement', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { announcement?: { id?: unknown; text?: unknown } | null } | null) => {
        if (cancelled) return
        const a = data?.announcement
        if (!a || typeof a.id !== 'string' || typeof a.text !== 'string' || !a.text) return
        if (a.id === seen) return
        setShown({ id: a.id, text: a.text })
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [suppressed])

  const close = useCallback(() => {
    setShown((current) => {
      if (current) {
        markAnnouncementSeen(current.id)
        track('announcement_dismissed', { id: current.id })
      }
      return null
    })
  }, [])

  useEffect(() => {
    if (!shown) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [shown, close])

  useEffect(() => {
    if (!shown) return
    const id = window.setTimeout(() => okRef.current?.focus(), 0)
    return () => window.clearTimeout(id)
  }, [shown])

  if (!shown || suppressed) return null

  return (
    <div className="pm-overlay" onClick={close}>
      <div
        className="pm-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Announcement"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 420 }}
      >
        <button className="pm-close" onClick={close} aria-label="ปิด">✕</button>
        <div className="whitespace-pre-wrap pt-2 pb-1 text-[length:calc(14px*var(--text-scale))] leading-relaxed text-[var(--fg)]">
          {shown.text}
        </div>
        <div className="flex justify-end mt-4">
          <button
            ref={okRef}
            type="button"
            onClick={close}
            className="px-5 py-2 rounded-md bg-[var(--accent,#2563eb)] text-white font-semibold text-[length:calc(13px*var(--text-scale))] hover:opacity-90"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  )
}
