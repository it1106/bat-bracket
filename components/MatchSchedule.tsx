'use client'

import type { MatchTimeGroup, MatchDay, MatchEntry } from '@/lib/types'

interface Props {
  timeGroups: MatchTimeGroup[]
  days: MatchDay[]
  selectedDay: string
  onDayChange: (date: string) => void
  loading: boolean
  playerQuery: string
}

function teamNames(team: MatchEntry['team1']): string[] {
  return team.map((p) => p.name)
}

function scoreStr(entry: MatchEntry): string {
  if (entry.walkover) return 'Walkover'
  if (entry.scores.length === 0) return '—'
  return entry.scores.map((s) => `${s.t1}-${s.t2}`).join(', ')
}

function isTracked(entry: MatchEntry, query: string): boolean {
  if (!query) return false
  const q = query.toLowerCase()
  return [...entry.team1, ...entry.team2].some((p) => p.name.toLowerCase().includes(q))
}

export default function MatchSchedule({ timeGroups, days, selectedDay, onDayChange, loading, playerQuery }: Props) {
  return (
    <div className="match-schedule">
      {/* Date tabs */}
      {days.length > 0 && (
        <div className="match-schedule__day-tabs">
          {days.map((d) => (
            <button
              key={d.date}
              onClick={() => onDayChange(d.date)}
              className={`match-schedule__day-tab${d.date === selectedDay ? ' active' : ''}`}
            >
              {d.label}
            </button>
          ))}
        </div>
      )}

      {loading && (
        <div className="p-8 text-center text-gray-400 text-sm">Loading matches…</div>
      )}

      {!loading && timeGroups.length === 0 && (
        <div className="p-8 text-center text-gray-400 text-sm">No matches scheduled for this day.</div>
      )}

      {!loading && timeGroups.map((group) => (
        <div key={group.time} className="match-schedule__time-group">
          <div className="match-schedule__time-header">{group.time}</div>
          <table className="match-schedule__table">
            <thead>
              <tr>
                <th>Event</th>
                <th>Round</th>
                <th>Team 1</th>
                <th>Score</th>
                <th>Team 2</th>
                <th>Court</th>
              </tr>
            </thead>
            <tbody>
              {group.matches.map((m, mi) => {
                const tracked = isTracked(m, playerQuery)
                const t1 = teamNames(m.team1)
                const t2 = teamNames(m.team2)
                return (
                  <tr key={mi} className={tracked ? 'match-schedule__row--tracked' : ''}>
                    <td className="match-schedule__event">{m.draw}</td>
                    <td className="match-schedule__round">{m.round}</td>
                    <td className={`match-schedule__team${m.winner === 1 ? ' winner' : ''}`}>
                      {t1.map((n, i) => <div key={i}>{n}</div>)}
                    </td>
                    <td className="match-schedule__score">{scoreStr(m)}</td>
                    <td className={`match-schedule__team${m.winner === 2 ? ' winner' : ''}`}>
                      {t2.map((n, i) => <div key={i}>{n}</div>)}
                    </td>
                    <td className="match-schedule__court">{m.court}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}
