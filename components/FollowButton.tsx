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

/** Follow one player: in this tournament, or wherever they play, and either
 *  for every alert or for the results alone. The permission prompt appears
 *  only after a tap here. Hidden where alerts cannot work at all.
 *
 *  The two choices sit under the button rather than behind it. Before the
 *  follow is made they say what the tap will do; after it they are what the
 *  follow is, and changing one changes the follow there and then — the same
 *  control doing the same thing, whichever side of the tap it is on. */
export default function FollowButton({ tournamentId, playerId, playerName, clubName }: Props) {
  const { t } = useLanguage()
  const push = usePushFollows()
  const [note, setNote] = useState<TKey | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [wanted, setWanted] = useState<{ scope: Scope; tier: AlertTier }>({ scope: 'tournament', tier: 'full' })

  if (push.status === 'off' || push.status === 'unsupported') return null

  const { here, everywhere } = push.playerFollows(tournamentId, playerId, playerName)
  const current = everywhere ?? here
  const direct = !!current
  const viaClub = !direct && push.isFollowingClub(tournamentId, clubName)
  const label = direct ? t('followingPlayer') : viaClub ? t('followingViaClub') : t('followPlayer')
  const props = { tournament_id: tournamentId, kind: 'player', player_id: playerId }
  // While following, the follow itself says what the choices are; before it,
  // what the next tap will make. Everything is followed everywhere second:
  // a player followed both ways is shown as the wider of the two.
  const scope: Scope = current ? (everywhere ? 'everywhere' : 'tournament') : wanted.scope
  const tier: AlertTier = current ? (current.tier === 'result' ? 'result' : 'full') : wanted.tier

  const targetFor = (s: Scope, k: AlertTier): FollowTarget =>
    s === 'everywhere'
      ? { kind: 'player', scope: 'everywhere', slug: followSlug(playerName), playerName, tier: k }
      : { kind: 'player', tournamentId, playerId, playerName, tier: k }

  /** Picks where the alerts come from, or how many. While the player is
   *  already followed it moves that follow: the new one is made before the
   *  old one goes, so a failure between the two leaves them followed more
   *  widely than asked, never followed by nothing. */
  const choose = async (next: { scope?: Scope; tier?: AlertTier }) => {
    const s = next.scope ?? scope
    const k = next.tier ?? tier
    setWanted({ scope: s, tier: k })
    if (!current || busy) return
    setBusy(true)
    try {
      const outcome = await push.follow(targetFor(s, k))
      if (outcome !== 'ok') return setNote(outcome === 'limit' ? 'followLimit' : 'followError')
      if (s !== scope) await push.unfollow(targetFor(scope, tier))
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
        <Chip on={scope === 'tournament'} busy={busy} label={t('followScopeHere')} onPick={() => void choose({ scope: 'tournament' })} />
        <Chip on={scope === 'everywhere'} busy={busy} label={t('followScopeEverywhere')} onPick={() => void choose({ scope: 'everywhere' })} />
        <span className="follow-opts-gap" />
        <Chip on={tier === 'full'} busy={busy} label={t('followTierFull')} onPick={() => void choose({ tier: 'full' })} />
        <Chip on={tier === 'result'} busy={busy} label={t('followTierResult')} onPick={() => void choose({ tier: 'result' })} />
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
