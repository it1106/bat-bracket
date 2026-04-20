'use client'

import { useEffect } from 'react'
import type { PlayerProfile, MatchEntry } from '@/lib/types'
import { abbrevRound } from '@/lib/scraper'

interface Props {
  profile: PlayerProfile | null
  loading: boolean
  onClose: () => void
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
              {profile.club && <div className="pm-club">{profile.club}</div>}
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
                  {profile.matches.map((m, i) => (
                    <div key={i} className="pm-match">
                      <div className="pm-match-meta">
                        <span className="pm-match-draw">{m.draw}</span>
                        <span className="pm-match-round">{abbrevRound(m.round)}</span>
                        {m.nowPlaying && <span className="ms-now-playing" title="Now playing" />}
                      </div>
                      <div className={`pm-match-team${m.winner === 1 ? ' winner' : ''}`}>
                        {m.team1.map((p) => p.name).join(' / ')}
                      </div>
                      <div className="pm-match-score">{scoreStr(m)}</div>
                      <div className={`pm-match-team${m.winner === 2 ? ' winner' : ''}`}>
                        {m.team2.map((p) => p.name).join(' / ')}
                      </div>
                    </div>
                  ))}
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
