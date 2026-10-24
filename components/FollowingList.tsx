'use client'

import { useLanguage } from '@/lib/LanguageContext'
import { usePushFollows } from '@/lib/push/PushFollowsContext'
import { track } from '@/lib/analytics'
import { isEverywhere, tierOf } from '@/lib/push/follows'
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
    } else if (isEverywhere(f)) {
      // The name key is the whole of such a follow; there is nothing else to
      // name it by, here or on the server.
      await push.unfollow({ kind: 'player', scope: 'everywhere', slug: f.slug ?? '', playerName: f.playerName })
      track('match_alert_unfollowed', { tournament_id: '', kind: 'player', player_id: '' })
    } else {
      await push.unfollow({ kind: 'player', tournamentId: f.tournamentId, playerId: f.playerId })
      track('match_alert_unfollowed', { tournament_id: f.tournamentId, kind: 'player', player_id: f.playerId })
    }
  }

  // Where a follow reaches, and how much it brings — only where that is
  // worth a line. Following a player reaches every tournament now, so saying
  // so on each row says nothing; what is worth marking is the follow that
  // does not, pinned to the one tournament it was made in before that
  // changed, and the club follow, which is a tournament's by its nature.
  const where = (f: PushFollow) => (isEverywhere(f) ? '' : tournamentNames[f.tournamentId] ?? '')
  const howMuch = (f: PushFollow) => (f.kind === 'player' && tierOf(f) === 'result' ? t('followTierResult') : '')

  return (
    <div className="following">
      <div className="pm-section-title">{t('followingTitle')}</div>
      {sorted.length === 0 ? (
        <div className="following-where">{t('followingEmpty')}</div>
      ) : (
        <ul className="following-list">
          {sorted.map((f) => (
            <li className="following-row" key={`${f.kind}:${f.tournamentId}:${f.kind === 'club' ? f.clubName : f.slug ?? f.playerId}`}>
              <span>
                <span>{nameOf(f)}</span>
                {[where(f), howMuch(f)].filter(Boolean).map((note) => (
                  <span className="following-where" key={note}> · {note}</span>
                ))}
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
