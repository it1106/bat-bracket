'use client'

import type { MatchScheduleGroup, MatchDay, MatchEntry } from '@/lib/types'
import { longRound } from '@/lib/scraper'

interface Props {
  groups: MatchScheduleGroup[]
  days: MatchDay[]
  selectedDay: string
  onDayChange: (date: string) => void
  loading: boolean
  playerQuery: string
  onEventClick?: (drawNum: string, round: string) => void
  playerClubMap?: Record<string, string>
  onPlayerClick?: (playerId: string) => void
  onH2HClick?: (h2hUrl: string) => void
}

function scoreStr(entry: MatchEntry): string {
  if (entry.walkover) return 'Walkover'
  if (entry.scores.length === 0) return 'vs.'
  const s = entry.scores.map((s) => `${s.t1}-${s.t2}`).join(', ')
  return entry.retired ? `${s} Ret.` : s
}

function matchesQuery(entry: MatchEntry, query: string, clubMap?: Record<string, string>): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  if (entry.draw.toLowerCase().includes(q)) return true
  return [...entry.team1, ...entry.team2].some((p) => playerMatchesQuery(p, q, clubMap))
}

function playerMatchesQuery(
  p: { name: string; playerId: string },
  qLower: string,
  clubMap?: Record<string, string>,
): boolean {
  if (!qLower) return false
  if (p.name.toLowerCase().includes(qLower)) return true
  if (clubMap && p.playerId && (clubMap[p.playerId] ?? '').toLowerCase().includes(qLower)) return true
  return false
}

export default function MatchSchedule({ groups, days, selectedDay, onDayChange, loading, playerQuery, onEventClick, playerClubMap, onPlayerClick, onH2HClick }: Props) {
  const qLower = playerQuery.trim().toLowerCase()
  const nameCls = (p: { name: string; playerId: string }) => {
    const cls: string[] = []
    if (onPlayerClick && p.playerId) cls.push('pm-player-link')
    if (qLower && playerMatchesQuery(p, qLower, playerClubMap)) cls.push('ms-player-highlight')
    return cls.join(' ')
  }

  const renderMatch = (m: MatchEntry, mi: number) => (
    <div key={mi} className="ms-match">
      <div className="ms-meta">
        <span
          className={`ms-event${onEventClick && m.drawNum ? ' ms-event--link' : ''}`}
          onClick={onEventClick && m.drawNum ? () => onEventClick(m.drawNum, m.round) : undefined}
        >{m.draw}</span>
        <span className="ms-round">{longRound(m.round)}</span>
        {m.sequenceLabel && <span className="ms-seq">{m.sequenceLabel}</span>}
        {m.nowPlaying && <span className="ms-now-playing" title="Now playing" />}
        {m.h2hUrl && onH2HClick && (
          <button
            className="ms-h2h-inline"
            onClick={() => onH2HClick(m.h2hUrl!)}
            title="Head to Head"
          >H2H</button>
        )}
      </div>

      <div className={`ms-team ms-team--1 ms-d${m.winner === 1 ? ' winner' : ''}`}>
        {m.team1.map((p, i) => (
          <div key={i} className={nameCls(p)} onClick={onPlayerClick && p.playerId ? () => onPlayerClick(p.playerId) : undefined}>{p.name}</div>
        ))}
      </div>
      <div className="ms-score ms-d">{scoreStr(m)}</div>
      <div className={`ms-team ms-team--2 ms-d${m.winner === 2 ? ' winner' : ''}`}>
        {m.team2.map((p, i) => (
          <div key={i} className={nameCls(p)} onClick={onPlayerClick && p.playerId ? () => onPlayerClick(p.playerId) : undefined}>{p.name}</div>
        ))}
      </div>

      <div className="ms-board ms-m">
        <div className={`ms-board-row${m.winner === 1 ? ' winner' : ''}`}>
          <div className="ms-board-players">
            {m.team1.map((p, i) => <div key={i} className={nameCls(p)} onClick={onPlayerClick && p.playerId ? () => onPlayerClick(p.playerId) : undefined}>{p.name}</div>)}
          </div>
          {m.walkover
            ? <span className="ms-board-badge">{m.winner === 1 ? 'Walkover' : ''}</span>
            : <>{m.scores.map((s, i) => <span key={i} className="ms-board-set">{s.t1}</span>)}{m.retired && m.winner === 1 && <span className="ms-board-badge">Ret.</span>}</>
          }
        </div>
        <div className={`ms-board-row${m.winner === 2 ? ' winner' : ''}`}>
          <div className="ms-board-players">
            {m.team2.map((p, i) => <div key={i} className={nameCls(p)} onClick={onPlayerClick && p.playerId ? () => onPlayerClick(p.playerId) : undefined}>{p.name}</div>)}
          </div>
          {m.walkover
            ? <span className="ms-board-badge">{m.winner === 2 ? 'Walkover' : ''}</span>
            : <>{m.scores.map((s, i) => <span key={i} className="ms-board-set">{s.t2}</span>)}{m.retired && m.winner === 2 && <span className="ms-board-badge">Ret.</span>}</>
          }
        </div>
      </div>
    </div>
  )

  return (
    <div className="match-schedule">
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

      {!loading && groups.length === 0 && (
        <div className="p-8 text-center text-gray-400 text-sm">No matches scheduled for this day.</div>
      )}

      {!loading && groups.map((group, gi) => {
        const filtered = playerQuery
          ? group.matches.filter((m) => matchesQuery(m, playerQuery, playerClubMap))
          : group.matches
        if (filtered.length === 0) return null

        const headerText = group.type === 'court' ? group.court : group.time

        return (
          <div key={gi} className="match-schedule__time-group">
            <div className="match-schedule__time-header">{headerText}</div>
            <div className="ms-list">
              {filtered.map((m, mi) => renderMatch(m, mi))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
