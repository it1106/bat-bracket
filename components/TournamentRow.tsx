'use client'
import Link from 'next/link'
import { useLanguage } from '@/lib/LanguageContext'
import type { BatRankingPlayerTournament } from '@/lib/types'

interface Props {
  row: BatRankingPlayerTournament
  /** Row's week is at-or-before the cutoff: its points will fall out of
   *  the 52-week ranking window when next Tuesday's publication lands. */
  expiring?: boolean
}

/**
 * Single tournament row inside a ranking-detail block. Tournament name links
 * to the in-app tournament view when we have a GUID; otherwise renders as
 * plain text. All other fields are display-only.
 */
export default function TournamentRow({ row, expiring = false }: Props) {
  const { t } = useLanguage()
  const name = row.tournamentId
    ? <Link href={`/?tournament=${row.tournamentId}`}>{row.tournamentName}</Link>
    : <span>{row.tournamentName}</span>
  return (
    <div
      className={`pp-rd-row${expiring ? ' pp-rd-row--expiring' : ''}`}
      title={expiring ? t('rankingDetailExpiringSoon') : undefined}
    >
      <span>{name}</span>
      <span className="pp-rd-row-event">{row.sourceEvent}</span>
      <span className="pp-rd-row-week">{row.week}</span>
      <span className="pp-rd-row-result">{row.result}</span>
      <span className="pp-rd-row-pts">{row.points.toLocaleString()}</span>
    </div>
  )
}
