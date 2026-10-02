'use client'

// "● 12 online" — how many devices have the site open right now, from the
// /api/presence heartbeat (see lib/PresenceContext). Clicking cycles to
// "▲ 31 peak today", the most online at once so far today, and back.

import { useState } from 'react'
import { useLanguage } from '@/lib/LanguageContext'
import { usePresence } from '@/lib/PresenceContext'
import { track } from '@/lib/analytics'

export default function OnlinePill() {
  const { t } = useLanguage()
  const presence = usePresence()
  const [showPeak, setShowPeak] = useState(false)
  if (presence == null) return null
  const tooltip = t(showPeak ? 'onlinePeakTooltip' : 'onlineTooltip')
  return (
    <button
      type="button"
      onClick={() => {
        track('online_pill_toggled', { to: showPeak ? 'online' : 'peak' })
        setShowPeak(!showPeak)
      }}
      title={tooltip}
      className="online-pill"
    >
      {showPeak ? (
        <>
          <span className="online-pill-peak" aria-hidden="true">▲</span>
          {t('onlinePeak').replace('{n}', presence.peak.toLocaleString())}
        </>
      ) : (
        <>
          <span className="online-pill-dot" aria-hidden="true" />
          {presence.online.toLocaleString()} {t('online')}
        </>
      )}
    </button>
  )
}
