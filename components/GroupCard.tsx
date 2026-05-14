'use client'
import { useState } from 'react'
import StandingsTable from './StandingsTable'
import type { GroupData, MatchEntry } from '@/lib/types'

interface Props {
  group: GroupData
  qualifierCount: number
  onPlayerClick?: (playerId: string) => void
  onExpand?: (groupLetter: string) => void
}

function MatchRow({ match }: { match: MatchEntry }) {
  const score = match.retired
    ? match.scores.map(s => `${s.t1}-${s.t2}`).join(', ') + ' Ret.'
    : match.walkover
      ? 'Walkover'
      : match.scores.map(s => `${s.t1}-${s.t2}`).join(', ')
  const teamLabel = (team: typeof match.team1) =>
    team.map(p => p.name).filter(Boolean).join(' / ') || '—'
  return (
    <div className="group-match-row flex items-center justify-between gap-3 py-1.5 px-2 rounded bg-gray-50 dark:bg-gray-800/40 mb-1.5">
      <div className="min-w-0 flex-1">
        <div className={match.winner === 1 ? 'font-semibold' : 'text-gray-600 dark:text-gray-400'}>
          {match.team1.map((p, i) => (
            <span key={i} data-player-id={p.playerId || undefined}>{p.name}{i < match.team1.length - 1 ? ' / ' : ''}</span>
          ))}
          {match.team1.length === 0 && '—'}
        </div>
        <div className="text-[10px] text-gray-400 my-0.5">vs</div>
        <div className={match.winner === 2 ? 'font-semibold' : 'text-gray-600 dark:text-gray-400'}>
          {match.team2.map((p, i) => (
            <span key={i} data-player-id={p.playerId || undefined}>{p.name}{i < match.team2.length - 1 ? ' / ' : ''}</span>
          ))}
          {match.team2.length === 0 && '—'}
        </div>
        {/* Visually hidden combined label so screen readers and tests can find aggregate */}
        <span className="sr-only">{teamLabel(match.team1)} vs {teamLabel(match.team2)}</span>
      </div>
      <div className="font-mono text-xs whitespace-nowrap">{score}</div>
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
        <div className="px-3 pb-3">
          {Array.from(byRound.entries()).map(([round, ms]) => (
            <div key={round} className="mt-2">
              <div className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">{round}</div>
              {ms.map((m, i) => <MatchRow key={i} match={m} />)}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
