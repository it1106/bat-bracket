'use client'

import { useState } from 'react'
import { useLanguage } from '@/lib/LanguageContext'
import { usePushFollows } from '@/lib/push/PushFollowsContext'
import { track } from '@/lib/analytics'
import { BELL } from '@/components/FollowButton'
import type { TKey } from '@/lib/i18n'

const WARNED_KEY = 'batbracket.followClubWarned'

function wasWarned(): boolean {
  try { return localStorage.getItem(WARNED_KEY) === '1' } catch { return true }
}

/** Follow every player a club has in one tournament. The first time on a
 *  device, the first tap only says how many alerts that can mean. */
export default function FollowClubButton({ tournamentId, clubName }: { tournamentId: string; clubName: string }) {
  const { t } = useLanguage()
  const push = usePushFollows()
  const [note, setNote] = useState<TKey | null>(null)
  const [busy, setBusy] = useState(false)

  if (push.status === 'off' || push.status === 'unsupported') return null

  const on = push.isFollowingClub(tournamentId, clubName)
  const props = { tournament_id: tournamentId, kind: 'club', club: clubName }
  const blocked = (reason: string, key: TKey) => {
    track('match_alert_blocked', { reason })
    setNote(key)
  }

  const onClick = async () => {
    if (busy) return
    if (push.status === 'needs-install') return blocked('needs-install', 'followNeedsInstall')
    if (push.status === 'in-app-browser') return blocked('in-app-browser', 'followInAppBrowser')
    if (!on && !wasWarned()) {
      try { localStorage.setItem(WARNED_KEY, '1') } catch { /* asked every time, then */ }
      setNote('followClubWarning')
      return
    }
    setNote(null)
    setBusy(true)
    try {
      if (on) {
        await push.unfollow({ kind: 'club', tournamentId, clubName })
        track('match_alert_unfollowed', props)
        return
      }
      if (push.permission === 'denied') return blocked('denied', 'followBlocked')
      const outcome = await push.follow({ kind: 'club', tournamentId, clubName })
      if (outcome === 'ok') track('match_alert_followed', props)
      else if (outcome === 'denied') blocked('denied', 'followBlocked')
      // closed without an answer: nothing is blocked, the next tap asks again
      else if (outcome !== 'dismissed') setNote(outcome === 'limit' ? 'followLimit' : 'followError')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="follow-wrap">
      <button type="button" className={`follow-btn${on ? ' follow-btn--on' : ''}`} aria-pressed={on} disabled={busy} onClick={onClick}>
        {BELL}
        <span>{on ? t('followingClub') : t('followClub')}</span>
      </button>
      {note && <div className="follow-note" role="status">{t(note)}</div>}
    </div>
  )
}
