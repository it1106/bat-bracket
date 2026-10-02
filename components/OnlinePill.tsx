'use client'

// "● 12 online" — how many devices have the site open right now, from the
// /api/presence heartbeat (see lib/PresenceContext). Clicking cycles to
// "▲ 31 peak" (the most online at once so far today), then "412 today"
// (distinct devices seen today), and back. Labels are kept short so the pill
// stays on the toolbar row on phones.

import { useState } from 'react'
import { useLanguage } from '@/lib/LanguageContext'
import { usePresence } from '@/lib/PresenceContext'
import { track } from '@/lib/analytics'

const MODES = ['online', 'peak', 'users'] as const
type Mode = (typeof MODES)[number]

export default function OnlinePill() {
  const { t } = useLanguage()
  const presence = usePresence()
  const [mode, setMode] = useState<Mode>('online')
  if (presence == null) return null
  const tooltip = t(
    mode === 'online' ? 'onlineTooltip' : mode === 'peak' ? 'onlinePeakTooltip' : 'onlineUsersTooltip',
  )
  return (
    <button
      type="button"
      onClick={() => {
        const next = MODES[(MODES.indexOf(mode) + 1) % MODES.length]
        track('online_pill_toggled', { to: next })
        setMode(next)
      }}
      title={tooltip}
      className="online-pill"
    >
      {mode === 'online' && (
        <>
          <span className="online-pill-dot" aria-hidden="true" />
          {presence.online.toLocaleString()} {t('online')}
        </>
      )}
      {mode === 'peak' && (
        <>
          <span className="online-pill-peak" aria-hidden="true">▲</span>
          {t('onlinePeak').replace('{n}', presence.peak.toLocaleString())}
        </>
      )}
      {mode === 'users' && (
        <>
          <svg className="online-pill-users" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <circle cx="8" cy="5" r="3" />
            <path d="M2 14c0-3 2.7-5 6-5s6 2 6 5z" />
          </svg>
          {t('onlineUsers').replace('{n}', presence.users.toLocaleString())}
        </>
      )}
    </button>
  )
}
