'use client'

import { useState } from 'react'
import { useLanguage } from '@/lib/LanguageContext'
import { usePushFollows } from '@/lib/push/PushFollowsContext'
import { track } from '@/lib/analytics'
import type { TKey } from '@/lib/i18n'

interface Props {
  tournamentId: string
  playerId: string
  playerName: string
  /** The player's club in this tournament, to show a club follow that covers them. */
  clubName?: string
}

export const BELL = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </svg>
)

/** Follow one player in one tournament. The permission prompt appears only
 *  after a tap here. Hidden where alerts cannot work at all. */
export default function FollowButton({ tournamentId, playerId, playerName, clubName }: Props) {
  const { t } = useLanguage()
  const push = usePushFollows()
  const [note, setNote] = useState<TKey | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  if (push.status === 'off' || push.status === 'unsupported') return null

  const direct = push.isFollowingPlayer(tournamentId, playerId)
  const viaClub = !direct && push.isFollowingClub(tournamentId, clubName)
  const label = direct ? t('followingPlayer') : viaClub ? t('followingViaClub') : t('followPlayer')
  const props = { tournament_id: tournamentId, kind: 'player', player_id: playerId }

  const blocked = (reason: string, key: TKey) => {
    track('match_alert_blocked', { reason })
    setNote(key)
  }

  const onClick = async () => {
    if (busy) return
    setNote(null)
    // A club follow covers this player; it is undone from the Following list.
    if (viaClub) return
    if (push.status === 'needs-install') return blocked('needs-install', 'followNeedsInstall')
    if (push.status === 'in-app-browser') return blocked('in-app-browser', 'followInAppBrowser')
    setBusy(true)
    try {
      if (direct) {
        await push.unfollow({ kind: 'player', tournamentId, playerId })
        track('match_alert_unfollowed', props)
        return
      }
      if (push.permission === 'denied') return blocked('denied', 'followBlocked')
      const outcome = await push.follow({ kind: 'player', tournamentId, playerId, playerName })
      if (outcome === 'ok') track('match_alert_followed', props)
      else if (outcome === 'denied') blocked('denied', 'followBlocked')
      else setNote(outcome === 'limit' ? 'followLimit' : 'followError')
    } finally {
      setBusy(false)
    }
  }

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/?tournament=${tournamentId}`)
      setCopied(true)
    } catch { /* nothing to copy with: the note already says what to do */ }
  }

  return (
    <div className="follow-wrap">
      <button
        type="button"
        className={`follow-btn${direct || viaClub ? ' follow-btn--on' : ''}`}
        aria-pressed={direct || viaClub}
        disabled={busy}
        onClick={onClick}
      >
        {BELL}
        <span>{label}</span>
      </button>
      {note && (
        <div className="follow-note" role="status">
          {t(note)}
          {note === 'followInAppBrowser' && (
            <button type="button" className="follow-copy" onClick={copyLink}>{copied ? t('followLinkCopied') : t('followCopyLink')}</button>
          )}
        </div>
      )}
    </div>
  )
}
