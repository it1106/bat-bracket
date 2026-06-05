'use client'
import React from 'react'
import { useRouter } from 'next/navigation'
import { weekKeyFromPublishDate } from '@/lib/ranking/player-view'
import { getRankingConfig } from '@/lib/ranking/config'
import { useLanguage } from '@/lib/LanguageContext'
import RankingDetailTabs from './RankingDetailTabs'
import type {
  ProviderTag,
  Ranking,
  RankingPlayerDetail,
  RankingPlayerRank,
} from '@/lib/types'

interface Props {
  /** Provider tag for the URL space (in practice always 'bwf' today, but
   *  the BAT branch can theoretically fall through here too if a BAT
   *  player's slug is missing from the index — render minimally rather
   *  than 404). */
  provider: ProviderTag
  slug: string
  displayName: string
  /** Country derived from the ranking entry's `club` field. BWF stores
   *  the player's country there; an empty string hides the row. */
  country: string
  playerRankings: RankingPlayerRank[]
  rankingPublishDate?: string
  initialDetail?: RankingPlayerDetail
  currentRanking?: Ranking | null
}

/**
 * A stripped-down profile rendered when a player is BWF-ranked but absent
 * from our local player index (we never scraped any tournament they
 * played). Shows only what the ranking cache directly provides: name,
 * country, the rank/points per event, and the Ranking Detail panel.
 *
 * Match-driven sections (KPIs, Tournament history, Recent form, Opponents,
 * etc.) are omitted — we don't have that data for these players.
 */
export default function MinimalPlayerProfile({
  provider,
  slug,
  displayName,
  country,
  playerRankings,
  rankingPublishDate,
  initialDetail,
  currentRanking,
}: Props) {
  const router = useRouter()
  useLanguage() // currently unused; reserved for future i18n on the header
  const rankingWeekKey = rankingPublishDate
    ? weekKeyFromPublishDate(rankingPublishDate, getRankingConfig(provider).dateFormat)
    : null

  const goBack = (e: React.MouseEvent) => {
    e.preventDefault()
    if (window.history.length > 1) router.back()
    else router.push('/leaderboards')
  }

  return (
    <div className="pp-page">
      <a href="/leaderboards" className="pp-back" onClick={goBack}>← Back</a>
      <div className="pp-hdr">
        <h1>{displayName}</h1>
        <div className="pp-meta">
          {country && <span>🌐 <strong>{country}</strong></span>}
        </div>
      </div>

      {playerRankings.length > 0 && (
        <div className="pp-section pp-ranking-section">
          <h2>{provider === 'bwf' ? 'BWF Badminton Asia Ranking' : 'Current Ranking'}{rankingPublishDate && (
            <span className="pp-stats-note">as of {rankingPublishDate}{rankingWeekKey && ` (${rankingWeekKey})`}</span>
          )}</h2>
          <div className="pp-ranking-list">
            {playerRankings.map(r => (
              <div key={r.eventName} className="pp-ranking-row">
                <span className="pp-ranking-event">{r.eventName}</span>
                <span className="pp-ranking-pos">#{r.rank}</span>
                <span className="pp-ranking-tn">{r.tournaments} tn</span>
                <span className="pp-ranking-pts">{r.points.toLocaleString()} pts</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <RankingDetailTabs
        provider={provider}
        slug={slug}
        initialDetail={initialDetail}
        rankingPublishDate={rankingPublishDate}
        currentRanking={currentRanking}
      />
    </div>
  )
}
