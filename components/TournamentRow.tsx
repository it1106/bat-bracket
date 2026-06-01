'use client'
import Link from 'next/link'
import type { BatRankingPlayerTournament } from '@/lib/types'

interface Props { row: BatRankingPlayerTournament }

/**
 * Single tournament row inside a ranking-detail block. Tournament name links
 * to the in-app tournament view when we have a GUID; otherwise renders as
 * plain text. All other fields are display-only.
 */
export default function TournamentRow({ row }: Props) {
  const name = row.tournamentId
    ? <Link href={`/?tournament=${row.tournamentId}`}>{row.tournamentName}</Link>
    : <span>{row.tournamentName}</span>
  return (
    <div className="pp-rd-row">
      <span>{name}</span>
      <span className="pp-rd-row-event">{row.sourceEvent}</span>
      <span className="pp-rd-row-week">{row.week}</span>
      <span className="pp-rd-row-result">{row.result}</span>
      <span className="pp-rd-row-pts">{row.points.toLocaleString()}</span>
    </div>
  )
}
