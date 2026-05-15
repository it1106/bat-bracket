'use client'
import { useState } from 'react'
import StandingsTable from './StandingsTable'
import type { GroupData, MatchEntry, MatchPlayer } from '@/lib/types'

interface Props {
  group: GroupData
  qualifierCount: number
  onPlayerClick?: (playerId: string) => void
  onExpand?: (groupLetter: string) => void
}

function MatchRow({ match, onPlayerClick }: { match: MatchEntry; onPlayerClick?: (playerId: string) => void }) {
  const winner = match.winner

  const renderTeam = (team: MatchPlayer[], teamNum: 1 | 2) => {
    const lost = winner !== null && winner !== teamNum
    return (
      <div className={`ms-board-row${winner === teamNum ? ' winner' : ''}`}>
        <div className="ms-board-players">
          {team.length === 0 ? (
            <div>—</div>
          ) : team.map((p, i) => (
            <div key={i}>
              <span
                data-player-id={p.playerId || undefined}
                className={onPlayerClick && p.playerId ? 'cursor-pointer hover:underline' : undefined}
                onClick={onPlayerClick && p.playerId ? (e) => { e.stopPropagation(); onPlayerClick(p.playerId) } : undefined}
              >
                {p.name}
              </span>
            </div>
          ))}
        </div>
        {winner === teamNum && <span className="ms-board-dot" aria-label="winner" />}
        {match.walkover
          ? (lost ? <span className="ms-board-badge">W/O</span> : null)
          : (
            <>
              {match.scores.map((s, i) => {
                const own = teamNum === 1 ? s.t1 : s.t2
                const opp = teamNum === 1 ? s.t2 : s.t1
                const setLost = winner !== null && own < opp
                return <span key={i} className={`ms-board-set${setLost ? ' ms-board-set--lost' : ''}`}>{own}</span>
              })}
              {match.retired && lost && <span className="ms-board-badge">Ret.</span>}
            </>
          )}
      </div>
    )
  }

  return (
    <div className="ms-match">
      <div className="ms-board">
        {renderTeam(match.team1, 1)}
        {renderTeam(match.team2, 2)}
      </div>
    </div>
  )
}

export default function GroupCard({ group, qualifierCount, onPlayerClick, onExpand }: Props) {
  const [expanded, setExpanded] = useState(false)
  const played = group.matches.filter(m => m.scores.length > 0 || m.walkover).length

  const byRound = new Map<string, MatchEntry[]>()
  group.matches.forEach(m => {
    if (!byRound.has(m.round)) byRound.set(m.round, [])
    byRound.get(m.round)!.push(m)
  })

  return (
    <section
      id={`group-${group.groupLetter}`}
      className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden bg-white dark:bg-gray-900"
    >
      <header className="flex items-baseline justify-between px-3 py-2 bg-gray-50 dark:bg-gray-800/60 border-b border-gray-200 dark:border-gray-700">
        <h3 className="font-semibold text-sm">Group {group.groupLetter}</h3>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {played} / {group.matches.length} played
        </span>
      </header>
      <StandingsTable rows={group.standings} qualifierCount={qualifierCount} onPlayerClick={onPlayerClick} />
      {group.matches.length > 0 && (
        <button
          type="button"
          className="w-full text-left px-3 py-2 text-sm text-blue-600 dark:text-blue-400 border-t border-gray-200 dark:border-gray-700 hover:bg-blue-50/40 dark:hover:bg-blue-900/10"
          onClick={() => {
            setExpanded(e => {
              if (!e) onExpand?.(group.groupLetter)
              return !e
            })
          }}
        >
          {expanded ? 'Hide matches' : `Show matches (${group.matches.length})`}
        </button>
      )}
      {expanded && (
        <div className="group-card-matches px-3 pb-3">
          {Array.from(byRound.entries()).map(([round, ms]) => (
            <div key={round} className="mt-2">
              <div className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">{round}</div>
              {ms.map((m, i) => <MatchRow key={i} match={m} onPlayerClick={onPlayerClick} />)}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
