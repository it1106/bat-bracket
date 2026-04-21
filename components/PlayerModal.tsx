'use client'

import { useEffect, useState } from 'react'
import type { PlayerProfile, MatchEntry } from '@/lib/types'
import { abbrevRound } from '@/lib/scraper'

interface Props {
  profile: PlayerProfile | null
  loading: boolean
  onClose: () => void
  onH2HClick?: (h2hUrl: string) => void
}


function scoreStr(entry: MatchEntry): string {
  if (entry.walkover) return 'Walkover'
  if (entry.scores.length === 0) return 'vs.'
  const s = entry.scores.map((s) => `${s.t1}–${s.t2}`).join(', ')
  return entry.retired ? `${s} Ret.` : s
}

export default function PlayerModal({ profile, loading, onClose, onH2HClick }: Props) {
  const [activeEventIds, setActiveEventIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => { setActiveEventIds(new Set()) }, [profile?.playerId])

  const toggleEvent = (id: string) => {
    setActiveEventIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  if (!loading && !profile) return null

  const eventShortName = (name: string) => name.split(' (')[0].trim().toLowerCase()
  const activeEventShortNames = profile
    ? profile.events.filter((e) => activeEventIds.has(e.eventId)).map((e) => eventShortName(e.name))
    : []
  const matchInActiveEvent = (m: MatchEntry) => {
    if (activeEventIds.size === 0) return true
    if (m.eventId && activeEventIds.has(m.eventId)) return true
    const drawLower = m.draw.toLowerCase()
    return activeEventShortNames.some((n) => drawLower === n || drawLower.includes(n) || n.includes(drawLower))
  }

  return (
    <div className="pm-overlay" onClick={onClose}>
      <div className="pm-modal" onClick={(e) => e.stopPropagation()}>
        <button className="pm-close" onClick={onClose} aria-label="Close">✕</button>

        {loading && (
          <div className="pm-loading">Loading player profile…</div>
        )}

        {!loading && profile && (
          <>
            <div className="pm-header">
              <div className="pm-name">{profile.name}</div>
              {(profile.club || profile.yob) && (
                <div className="pm-club">
                  {[profile.club, profile.yob ? `YOB: ${profile.yob}` : ''].filter(Boolean).join(' · ')}
                </div>
              )}
            </div>

            {profile.events.length > 0 && (
              <div className="pm-section">
                <div className="pm-section-title">Events Entered</div>
                <div className="pm-events">
                  {profile.events.map((ev) => (
                    <button
                      key={ev.eventId}
                      type="button"
                      className={`pm-event-pill${activeEventIds.has(ev.eventId) ? ' active' : ''}`}
                      onClick={() => toggleEvent(ev.eventId)}
                    >{ev.name}</button>
                  ))}
                </div>
              </div>
            )}

            {profile.matches.length > 0 && (
              <div className="pm-section">
                <div className="pm-section-title">Match Results</div>
                <div className="pm-matches">
                  {profile.matches.filter(m => m.team1.length > 0 && m.team2.length > 0 && matchInActiveEvent(m)).map((m, i) => {
                    const renderName = (p: import('@/lib/types').MatchPlayer, pi: number) => (
                      <div key={pi}>{p.name}</div>
                    )
                    return (
                    <div key={i} className="pm-match">
                      {/* Meta: draw + round */}
                      <div className="pm-match-meta">
                        <span className="pm-match-draw">{m.draw}</span>
                        <span className="pm-match-round">{abbrevRound(m.round)}</span>
                        {m.nowPlaying && <span className="ms-now-playing" title="Now playing" />}
                        {m.h2hUrl && onH2HClick && (
                          <button
                            className="ms-h2h-inline"
                            onClick={() => onH2HClick(m.h2hUrl!)}
                            title="Head to Head"
                          >H2H</button>
                        )}
                      </div>

                      {/* Desktop: team1 | score | team2 */}
                      <div className={`pm-match-team pm-d${m.winner === 1 ? ' winner' : ''}`}>
                        {m.team1.length ? m.team1.map(renderName) : m.winner !== null ? <div className="pm-bye">Bye</div> : null}
                      </div>
                      <div className="pm-match-score pm-d">
                        {m.scheduledTime && !m.scores.length && !m.walkover ? m.scheduledTime : scoreStr(m)}
                      </div>
                      <div className={`pm-match-team pm-d${m.winner === 2 ? ' winner' : ''}`}>
                        {m.team2.length ? m.team2.map(renderName) : m.winner !== null ? <div className="pm-bye">Bye</div> : null}
                      </div>

                      {/* Mobile: two-row scoreboard */}
                      <div className="pm-board pm-m">
                        <div className={`pm-board-row${m.winner === 1 ? ' winner' : ''}`}>
                          <div className="pm-board-players">
                            {m.team1.length ? m.team1.map(renderName) : m.winner !== null ? <div className="pm-bye">Bye</div> : null}
                          </div>
                          {m.walkover
                            ? <span className="pm-board-badge">{m.winner === 1 ? 'Walkover' : ''}</span>
                            : <>{m.scores.map((s, si) => <span key={si} className="pm-board-set">{s.t1}</span>)}{m.retired && m.winner === 1 && <span className="pm-board-badge">Ret.</span>}</>
                          }
                        </div>
                        <div className={`pm-board-row${m.winner === 2 ? ' winner' : ''}`}>
                          <div className="pm-board-players">
                            {m.team2.length ? m.team2.map(renderName) : m.winner !== null ? <div className="pm-bye">Bye</div> : null}
                          </div>
                          {m.walkover
                            ? <span className="pm-board-badge">{m.winner === 2 ? 'Walkover' : ''}</span>
                            : <>{m.scores.map((s, si) => <span key={si} className="pm-board-set">{s.t2}</span>)}{m.retired && m.winner === 2 && <span className="pm-board-badge">Ret.</span>}</>
                          }
                        </div>
                      </div>
                      {m.scheduledTime && !m.scores.length && !m.walkover && (
                        <div className="pm-board-scheduled pm-m">{m.scheduledTime}</div>
                      )}
                    </div>
                  )})}
                </div>
              </div>
            )}

            {profile.matches.length === 0 && profile.events.length === 0 && (
              <div className="pm-empty">No match data available yet.</div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
