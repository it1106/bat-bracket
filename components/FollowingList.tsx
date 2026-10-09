'use client'

import { useLanguage } from '@/lib/LanguageContext'
import { usePushFollows } from '@/lib/push/PushFollowsContext'
import { track } from '@/lib/analytics'
import type { PushFollow } from '@/lib/push/types'

/** What this device follows, clubs first, each with a way to stop. Renders
 *  nothing where match alerts cannot work. */
export default function FollowingList({ tournamentNames }: { tournamentNames: Record<string, string> }) {
  const { t } = useLanguage()
  const push = usePushFollows()
  if (push.status !== 'ok') return null

  const sorted = push.follows.slice().sort((a, b) => Number(b.kind === 'club') - Number(a.kind === 'club'))
  const nameOf = (f: PushFollow) => (f.kind === 'club' ? f.clubName : f.playerName)

  const stop = async (f: PushFollow) => {
    if (f.kind === 'club') {
      await push.unfollow({ kind: 'club', tournamentId: f.tournamentId, clubName: f.clubName })
      track('match_alert_unfollowed', { tournament_id: f.tournamentId, kind: 'club', club: f.clubName })
    } else {
      await push.unfollow({ kind: 'player', tournamentId: f.tournamentId, playerId: f.playerId })
      track('match_alert_unfollowed', { tournament_id: f.tournamentId, kind: 'player', player_id: f.playerId })
    }
  }

  return (
    <div className="following">
      <div className="pm-section-title">{t('followingTitle')}</div>
      {sorted.length === 0 ? (
        <div className="following-where">{t('followingEmpty')}</div>
      ) : (
        <ul className="following-list">
          {sorted.map((f) => (
            <li className="following-row" key={`${f.kind}:${f.tournamentId}:${f.kind === 'club' ? f.clubName : f.playerId}`}>
              <span>
                <span>{nameOf(f)}</span>
                {tournamentNames[f.tournamentId] && <span className="following-where"> · {tournamentNames[f.tournamentId]}</span>}
              </span>
              <button type="button" className="follow-copy" aria-label={`${t('unfollow')} ${nameOf(f)}`} onClick={() => void stop(f)}>
                {t('unfollow')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
