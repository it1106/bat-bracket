'use client'

import type { MatchTimeGroup, MatchDay, MatchEntry } from '@/lib/types'
import { abbrevRound } from '@/lib/scraper'

interface Props {
  timeGroups: MatchTimeGroup[]
  days: MatchDay[]
  selectedDay: string
  onDayChange: (date: string) => void
  loading: boolean
  playerQuery: string
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
              className={[
                'match-schedule__day-tab',
                d.date === selectedDay ? 'active' : '',
                d.hasMatches === false ? 'empty' : '',
              ].filter(Boolean).join(' ')}
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
          <div className="ms-list">
            {group.matches.map((m, mi) => {
              const tracked = isTracked(m, playerQuery)
              return (
                <div key={mi} className={`ms-match${tracked ? ' ms-match--tracked' : ''}`}>
                  <div className="ms-meta">
                    <span className="ms-event">{m.draw}</span>
                    <span className="ms-round">{abbrevRound(m.round)}</span>
                  </div>
                  <div className={`ms-team ms-team--1${m.winner === 1 ? ' winner' : ''}`}>
                    {m.team1.map((p, i) => <div key={i}>{p.name}</div>)}
                  </div>
                  <div className="ms-score">{scoreStr(m)}</div>
                  <div className={`ms-team ms-team--2${m.winner === 2 ? ' winner' : ''}`}>
                    {m.team2.map((p, i) => <div key={i}>{p.name}</div>)}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
