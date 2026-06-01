'use client'

// Surfaces when the most recent /api/matches or /api/draws response carried
// X-Cache-Source: disk — meaning the data came from a durable .cache/full,
// .cache/days, or .cache/draws pin and no BAT call was made for this page.
// Different signal from StaleCacheBanner (red, "BAT down"): this badge is
// informational and shows on perfectly-healthy past-tournament views.

import { useLanguage } from '@/lib/LanguageContext'

interface Props {
  visible: boolean
}

export default function DiskCacheBadge({ visible }: Props) {
  const { t } = useLanguage()
  if (!visible) return null
  return (
    <span
      role="status"
      title={t('diskCacheBadgeTooltip')}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-[var(--border)] bg-[var(--surface)] text-[10px] font-medium text-[var(--muted)] select-none"
    >
      {/* Tiny disk-stack icon (database/storage glyph) */}
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <ellipse cx="12" cy="5" rx="9" ry="3" />
        <path d="M3 5v6c0 1.66 4.03 3 9 3s9-1.34 9-3V5" />
        <path d="M3 11v6c0 1.66 4.03 3 9 3s9-1.34 9-3v-6" />
      </svg>
      <span>{t('diskCacheBadge')}</span>
    </span>
  )
}
