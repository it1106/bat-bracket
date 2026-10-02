'use client'

// "● 12 online" — how many devices have the site open right now, from the
// /api/presence heartbeat (see lib/PresenceContext).

import { useLanguage } from '@/lib/LanguageContext'
import { useOnlineCount } from '@/lib/PresenceContext'

export default function OnlinePill() {
  const { t } = useLanguage()
  const online = useOnlineCount()
  if (online == null) return null
  return (
    <span
      role="status"
      title={t('onlineTooltip')}
      className="online-pill"
    >
      <span className="online-pill-dot" aria-hidden="true" />
      {online.toLocaleString()} {t('online')}
    </span>
  )
}
