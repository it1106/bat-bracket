'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { useLanguage } from '@/lib/LanguageContext'
import DisclaimerBody from '@/components/DisclaimerBody'
import { DISCLAIMER } from '@/lib/disclaimer'

/** The disclaimer as a modal, opened from the top bar's ⓘ button. Same body as
 *  /disclaimer, with a link through to that page for anyone who wants the URL.
 *  Mirrors CustomTabModal's shell: overlay click + Escape both close. */
export default function DisclaimerModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, lang } = useLanguage()

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="pm-overlay" onClick={onClose}>
      <div className="pm-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <button className="pm-close" onClick={onClose} aria-label={t('close')}>✕</button>
        <div className="pm-header">
          <div className="pm-section-title" lang={lang}>{DISCLAIMER[lang].title}</div>
        </div>
        <div className="pm-section">
          <DisclaimerBody />
          <p className="mt-3 text-xs">
            <Link href="/disclaimer" className="text-[var(--muted)] hover:underline">
              /disclaimer
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
