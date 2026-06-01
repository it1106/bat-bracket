'use client'
import Link from 'next/link'
import { useLanguage } from '@/lib/LanguageContext'
import type { ExpiryTier } from '@/lib/bat-ranking-player-view'
import type { BatRankingPlayerTournament } from '@/lib/types'

interface Props {
  row: BatRankingPlayerTournament
  /**
   *   'next' — row's points fall out at the very next publication
   *   'soon' — fall out within the next 4 publications
   *   null  — safe for at least 4 more publications
   */
  expiry?: ExpiryTier
}

/**
 * Single tournament row inside a ranking-detail block. Tournament name links
 * to the in-app tournament view when we have a GUID; otherwise renders as
 * plain text. All other fields are display-only.
 */
export default function TournamentRow({ row, expiry = null }: Props) {
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
  return (
    <div className={cls} title={title}>
      <span>{name}</span>
      <span className="pp-rd-row-event">{row.sourceEvent}</span>
      <span className="pp-rd-row-week">{row.week}</span>
      <span className="pp-rd-row-result">{row.result}</span>
      <span className="pp-rd-row-pts">{row.points.toLocaleString()}</span>
    </div>
  )
}
