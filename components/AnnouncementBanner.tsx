'use client'

import { useEffect, useState } from 'react'
import { isAnnouncementDismissed, dismissAnnouncement } from '@/lib/announcements'
import { track } from '@/lib/analytics'

interface Props {
  id: string
  text: string
  visible?: boolean
}

export default function AnnouncementBanner({ id, text, visible = true }: Props) {
  const [dismissed, setDismissed] = useState(true)
  const [hydrated, setHydrated] = useState(false)
  const [shownTracked, setShownTracked] = useState(false)

  useEffect(() => {
    setDismissed(isAnnouncementDismissed(id))
    setHydrated(true)
  }, [id])

  const isDisplaying = hydrated && !dismissed && visible

  useEffect(() => {
    if (!isDisplaying || shownTracked) return
    track('announcement_shown', { id })
    setShownTracked(true)
  }, [isDisplaying, shownTracked, id])

  if (!isDisplaying) return null

  const onClose = () => {
    dismissAnnouncement(id)
    setDismissed(true)
    track('announcement_dismissed', { id })
  }

  return (
    <div className="flex items-center gap-2 px-5 py-1.5 bg-[var(--info-bg)] border-b border-[var(--border)] text-xs text-[var(--info-fg)]">
      <div className="announcement-marquee" aria-live="polite">
        <div className="announcement-marquee__track" lang="th">
          <span>{text}</span>
          <span aria-hidden="true">{text}</span>
        </div>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="ปิด"
        className="inline-flex items-center justify-center w-4 h-4 rounded text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--border)] text-[11px] leading-none shrink-0"
      >✕</button>
    </div>
  )
}
