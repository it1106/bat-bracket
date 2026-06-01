'use client'
import { useState } from 'react'
import { useLanguage } from '@/lib/LanguageContext'
import type { RankingDetailBlock as Block } from '@/lib/bat-ranking-player-view'
import TournamentRow from './TournamentRow'

interface Props { block: Block }

/**
 * One ranking-category block inside the active discipline tab:
 *   header (event name + rank + total) + top-10 rows + optional
 *   "show more" toggle revealing same-discipline rows that don't
 *   contribute to this ranking.
 */
export default function RankingDetailBlock({ block }: Props) {
  const { t } = useLanguage()
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="pp-rd-block">
      <div className="pp-rd-block-hdr">
        <span className="pp-rd-block-name">{block.rankingEventName}</span>
        {block.playerRank > 0 && (
          <span className="pp-rd-block-rank">
            {t('rankingDetailRankLabel')} #{block.playerRank}
          </span>
        )}
        <span className="pp-rd-block-pts">{block.totalPoints.toLocaleString()} pts</span>
      </div>
      {block.topTen.map((row, i) => (
        <TournamentRow key={`${row.tournamentName}-${i}`} row={row} />
      ))}
      {block.otherRows.length > 0 && (
        <>
          {expanded && block.otherRows.map((row, i) => (
            <TournamentRow key={`other-${row.tournamentName}-${i}`} row={row} />
          ))}
          <button
            type="button"
            className="pp-rd-show-more"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded
              ? t('rankingDetailShowLess')
              : `${t('rankingDetailShowMore')} (${block.otherRows.length})`}
          </button>
        </>
      )}
    </div>
  )
}
