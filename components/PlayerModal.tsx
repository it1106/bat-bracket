'use client'

import { useEffect } from 'react'
import type { PlayerProfile, MatchEntry } from '@/lib/types'
import { abbrevRound } from '@/lib/scraper'

interface Props {
  profile: PlayerProfile | null
  loading: boolean
  onClose: () => void
}

function resultBubble(entry: MatchEntry, playerId: string): 'win' | 'loss' | null {
  if (entry.winner === null) return null
  const inTeam1 = entry.team1.some(p => p.playerId === playerId)
  const inTeam2 = entry.team2.some(p => p.playerId === playerId)
  if (!inTeam1 && !inTeam2) return null
  return (inTeam1 && entry.winner === 1) || (inTeam2 && entry.winner === 2) ? 'win' : 'loss'
}

function scoreStr(entry: MatchEntry): string {
  if (entry.walkover) return 'Walkover'
  if (entry.scores.length === 0) return '—'
  return entry.scores.map((s) => `${s.t1}–${s.t2}`).join(', ')
}

export default function PlayerModal({ profile, loading, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!loading && !profile) return null

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
                <ul className="pm-events">
                  {profile.events.map((ev) => (
                    <li key={ev.eventId} className="pm-event-item">{ev.name}</li>
                  ))}
                </ul>
              </div>
            )}

            {profile.matches.length > 0 && (
              <div className="pm-section">
                <div className="pm-section-title">Match Results</div>
                <div className="pm-matches">
                  {profile.matches.map((m, i) => {
                    const bubble = resultBubble(m, profile.playerId)
                    const renderName = (p: import('@/lib/types').MatchPlayer, pi: number) => (
                      <div key={pi} className="pm-player-row">
                        {p.playerId === profile.playerId && bubble && (
                          <span className={`pm-result-bubble pm-result-${bubble}`} />
                        )}
                        {p.name}
                      </div>
                    )
                    return (
                    <div key={i} className="pm-match">
                      {/* Meta: draw + round */}
                      <div className="pm-match-meta">
                        <span className="pm-match-draw">{m.draw}</span>
                        <span className="pm-match-round">{abbrevRound(m.round)}</span>
                        {m.nowPlaying && <span className="ms-now-playing" title="Now playing" />}
                      </div>

                      {/* Desktop: team1 | score | team2 */}
                      <div className={`pm-match-team pm-d${m.winner === 1 ? ' winner' : ''}`}>
                        {m.team1.length ? m.team1.map(renderName) : m.winner !== null ? <div className="pm-bye">Bye</div> : null}
                      </div>
                      <div className="pm-match-score pm-d">{scoreStr(m)}</div>
                      <div className={`pm-match-team pm-d${m.winner === 2 ? ' winner' : ''}`}>
                        {m.team2.length ? m.team2.map(renderName) : m.winner !== null ? <div className="pm-bye">Bye</div> : null}
                      </div>

                      {/* Scheduled time (upcoming matches) */}
                      {m.scheduledTime && !m.scores.length && !m.walkover && (
                        <div className="pm-match-scheduled pm-d">{m.scheduledTime}</div>
                      )}

                      {/* Mobile: two-row scoreboard */}
                      <div className="pm-board pm-m">
                        <div className={`pm-board-row${m.winner === 1 ? ' winner' : ''}`}>
                          <div className="pm-board-players">
                            {m.team1.length ? m.team1.map(renderName) : m.winner !== null ? <div className="pm-bye">Bye</div> : null}
                          </div>
                          {m.walkover
                            ? <span className="pm-board-badge">{m.winner === 1 ? 'Walkover' : ''}</span>
                            : m.scores.map((s, si) => <span key={si} className="pm-board-set">{s.t1}</span>)
                          }
                        </div>
                        <div className={`pm-board-row${m.winner === 2 ? ' winner' : ''}`}>
                          <div className="pm-board-players">
                            {m.team2.length ? m.team2.map(renderName) : m.winner !== null ? <div className="pm-bye">Bye</div> : null}
                          </div>
                          {m.walkover
                            ? <span className="pm-board-badge">{m.winner === 2 ? 'Walkover' : ''}</span>
                            : m.scores.map((s, si) => <span key={si} className="pm-board-set">{s.t2}</span>)
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
