'use client'
import type { StandingsRow } from '@/lib/types'

interface Props {
  rows: StandingsRow[]
  qualifierCount: number
  onPlayerClick?: (playerId: string) => void
}

export default function StandingsTable({ rows, qualifierCount, onPlayerClick }: Props) {
  if (rows.length === 0) return null
  const anyPlayed = rows.some((r) => r.played > 0)

  return (
    <table className="w-full text-sm border-collapse">
      <thead className="text-xs uppercase text-gray-500 dark:text-gray-400">
        <tr>
          <th className="text-left py-1.5 px-2 w-8">Pos</th>
          <th className="text-left py-1.5 px-2">Player</th>
          <th className="text-right py-1.5 px-2 w-8" title="Played">Pl</th>
          <th className="text-right py-1.5 px-2 w-12">W-L</th>
          <th className="text-right py-1.5 px-2 w-16" title="Points">Gm</th>
          <th className="text-right py-1.5 px-2 w-10 font-semibold">Pts</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const advances = i < qualifierCount
          const playerHtml = r.players.length === 0
            ? <span className="text-gray-400">—</span>
            : r.players.map((p, pi) => (
                <span key={pi} className="block">
                  <button
                    type="button"
                    data-player-id={p.playerId || undefined}
                    className="text-left hover:underline"
                    onClick={() => p.playerId && onPlayerClick?.(p.playerId)}
                  >
                    {p.name || '—'}
                  </button>
                </span>
              ))
          return (
            <tr
              key={r.position + ':' + (r.players[0]?.playerId ?? i)}
              className={`standings-row border-t border-gray-200 dark:border-gray-700 ${advances ? 'advances' : ''}`}
            >
              <td className="py-1.5 px-2 align-top">
                {anyPlayed ? (
                  <span className={advances ? 'text-green-600 dark:text-green-400 font-semibold' : 'text-gray-500'}>
                    {advances ? <span title="Advances to playoff" aria-label="advances">→</span> : null}
                    {r.position}
                  </span>
                ) : <span className="text-gray-400">—</span>}
              </td>
              <td className="py-1.5 px-2">
                {playerHtml}
                {r.club && <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{r.club}</div>}
              </td>
              <td className="py-1.5 px-2 text-right">{r.played}</td>
              <td className="py-1.5 px-2 text-right tabular-nums">{r.won}-{r.lost}</td>
              <td className="py-1.5 px-2 text-right tabular-nums">{r.games}</td>
              <td className="py-1.5 px-2 text-right font-semibold">{r.pts}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
