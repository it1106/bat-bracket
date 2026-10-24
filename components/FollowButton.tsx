'use client'

import { useState } from 'react'
import { useLanguage } from '@/lib/LanguageContext'
import { usePushFollows } from '@/lib/push/PushFollowsContext'
import { track } from '@/lib/analytics'
import { followSlug } from '@/lib/push/follows'
import type { AlertTier, FollowTarget } from '@/lib/push/types'
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

type Scope = 'tournament' | 'everywhere'

/** Follow one player, wherever they play, for every alert or for the results
 *  alone. The permission prompt appears only after a tap here. Hidden where
 *  alerts cannot work at all.
 *
 *  Following is not asked where: a player is one person in whichever
 *  tournament they turn up, and being told about them only in the one the
 *  bell happened to be opened in was never what anyone wanted. Follows made
 *  before that was settled are still pinned to their tournament and are
 *  honoured as they are — shown, retiered and unfollowed where they sit —
 *  but no new one is made that way.
 *
 *  How much it says does sit under the button. Before the follow is made the
 *  choice says what the tap will do; after it, it is what the follow is, and
 *  changing it changes the follow there and then. */
export default function FollowButton({ tournamentId, playerId, playerName, clubName }: Props) {
  const { t } = useLanguage()
  const push = usePushFollows()
  const [note, setNote] = useState<TKey | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [wantedTier, setWantedTier] = useState<AlertTier>('full')

  if (push.status === 'off' || push.status === 'unsupported') return null

  const { here, everywhere } = push.playerFollows(tournamentId, playerId, playerName)
  const current = everywhere ?? here
  const direct = !!current
  const viaClub = !direct && push.isFollowingClub(tournamentId, clubName)
  const label = direct ? t('followingPlayer') : viaClub ? t('followingViaClub') : t('followPlayer')
  const props = { tournament_id: tournamentId, kind: 'player', player_id: playerId }
  // A new follow goes everywhere. An older one keeps the scope it has, so
  // that the tap which unfollows it names the follow that is really there.
  const scope: Scope = current && !everywhere ? 'tournament' : 'everywhere'
  const tier: AlertTier = current ? (current.tier === 'result' ? 'result' : 'full') : wantedTier

  const targetFor = (s: Scope, k: AlertTier): FollowTarget =>
    s === 'everywhere'
      ? { kind: 'player', scope: 'everywhere', slug: followSlug(playerName), playerName, tier: k }
      : { kind: 'player', tournamentId, playerId, playerName, tier: k }

  /** Picks how much the alerts say. While the player is already followed it
   *  changes that follow where it is: following again is what the server
   *  reads as a change of tier. */
  const choose = async (k: AlertTier) => {
    setWantedTier(k)
    if (!current || busy) return
    setBusy(true)
    try {
      const outcome = await push.follow(targetFor(scope, k))
      if (outcome !== 'ok') setNote(outcome === 'limit' ? 'followLimit' : 'followError')
    } finally {
      setBusy(false)
    }
  }

  const blocked = (reason: string, key: TKey) => {
    track('match_alert_blocked', { reason })
    setNote(key)
  }

  const onClick = async () => {
    if (busy) return
    setNote(null)
    // A club follow covers this player; it is undone from the Following list.
    if (viaClub) return setNote('followViaClubNote')
    if (push.status === 'needs-install') return blocked('needs-install', 'followNeedsInstall')
    if (push.status === 'in-app-browser') return blocked('in-app-browser', 'followInAppBrowser')
    setBusy(true)
    try {
      if (direct) {
        await push.unfollow(targetFor(scope, tier))
        track('match_alert_unfollowed', props)
        return
      }
      if (push.permission === 'denied') return blocked('denied', 'followBlocked')
      const outcome = await push.follow(targetFor(scope, tier))
      if (outcome === 'ok') track('match_alert_followed', props)
      else if (outcome === 'denied') blocked('denied', 'followBlocked')
      // closed without an answer: nothing is blocked, the next tap asks again
      else if (outcome !== 'dismissed') setNote(outcome === 'limit' ? 'followLimit' : 'followError')
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
      <div className="follow-row">
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
        {/* Match alerts are new: say so next to the button that turns them on. */}
        <span className="follow-beta">beta</span>
      </div>
      <div className="follow-opts">
        <Chip on={tier === 'full'} busy={busy} label={t('followTierFull')} onPick={() => void choose('full')} />
        <Chip on={tier === 'result'} busy={busy} label={t('followTierResult')} onPick={() => void choose('result')} />
      </div>
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

/** One of the four small choices under the bell. */
function Chip({ on, busy, label, onPick }: { on: boolean; busy: boolean; label: string; onPick: () => void }) {
  return (
    <button type="button" className={`follow-chip${on ? ' follow-chip--on' : ''}`} aria-pressed={on} disabled={busy} onClick={onPick}>
      {label}
    </button>
  )
}
