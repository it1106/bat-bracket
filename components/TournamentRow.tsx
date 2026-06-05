'use client'
import Link from 'next/link'
import { useLanguage } from '@/lib/LanguageContext'
import type { ExpiryTier } from '@/lib/ranking/player-view'
import type { RankingPlayerTournament } from '@/lib/types'

interface Props {
  row: RankingPlayerTournament
  /**
   *   'next' — row's points fall out at the very next publication
   *   'soon' — fall out within the next 4 publications
   *   null  — safe for at least 4 more publications
   */
  expiry?: ExpiryTier
  /** When set, the points cell shows the row's raw points → this credit
   *  (e.g. "2125 → 638"). When equal to raw points or undefined, the cell
   *  renders the single number as today. */
  creditOverride?: number
}

/**
 * Single tournament row inside a ranking-detail block. Tournament name links
 * to the in-app tournament view when we have a GUID; otherwise renders as
 * plain text. All other fields are display-only.
 */
export default function TournamentRow({ row, expiry = null, creditOverride }: Props) {
  const { t } = useLanguage()
  const cls = expiry === 'next'
    ? 'pp-rd-row pp-rd-row--expiring'
    : expiry === 'soon'
      ? 'pp-rd-row pp-rd-row--expiring-soon'
      : 'pp-rd-row'
  const title = expiry === 'next'
    ? t('rankingDetailExpiringNext')
    : expiry === 'soon'
      ? t('rankingDetailExpiringWithin4Weeks')
      : undefined
  const name = row.tournamentId
    ? <Link href={`/?tournament=${row.tournamentId}`}>{row.tournamentName}</Link>
    : <span>{row.tournamentName}</span>
  const showDiscount = creditOverride != null && Math.round(creditOverride) !== row.points
  const pointsCell = showDiscount
    ? `${row.points.toLocaleString()} → ${Math.round(creditOverride!).toLocaleString()}`
    : row.points.toLocaleString()
  return (
    <div className={cls} title={title}>
      <span>{name}</span>
      <span className="pp-rd-row-event">{row.sourceEvent}</span>
      <span className="pp-rd-row-week">{row.week}</span>
      <span className="pp-rd-row-result">{row.result}</span>
      <span className="pp-rd-row-pts">{pointsCell}</span>
    </div>
  )
}
