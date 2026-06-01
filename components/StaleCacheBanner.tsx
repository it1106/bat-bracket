'use client'

// Surfaces when /api/matches responses carry X-Stale-Cache: 1 — meaning the
// upstream (BAT) is unreachable and we're serving a previously-cached copy.
// Not dismissible by design: while BAT is down, the user should keep seeing
// the warning so they don't mistake stale info for live data. The banner
// clears automatically when the next request succeeds without the header.

import { useLanguage } from '@/lib/LanguageContext'

interface Props {
  visible: boolean
}

export default function StaleCacheBanner({ visible }: Props) {
  const { t } = useLanguage()
  if (!visible) return null
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 px-5 py-1.5 bg-red-600 border-b border-red-700 text-xs text-white font-medium"
    >
      <span aria-hidden="true">⚠</span>
      <span>{t('staleCacheBanner')}</span>
    </div>
  )
}
