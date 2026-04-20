'use client'

import { useEffect } from 'react'
import type { H2HData, MatchScore } from '@/lib/types'

interface Props {
  data: H2HData | null
  loading: boolean
  onClose: () => void
}

function scoreStr(scores: MatchScore[], walkover: boolean, retired: boolean): string {
  if (walkover) return 'Walkover'
  if (scores.length === 0) return '—'
  const s = scores.map((s) => `${s.t1}–${s.t2}`).join(', ')
  return retired ? `${s} Ret.` : s
}

export default function H2HModal({ data, loading, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!loading && !data) return null

  return (
    <div className="pm-overlay" onClick={onClose}>
      <div className="pm-modal h2h-modal" onClick={(e) => e.stopPropagation()}>
        <button className="pm-close" onClick={onClose} aria-label="Close">✕</button>

        {loading && <div className="pm-loading">Loading H2H data…</div>}

        {!loading && data && (
          <>
            <div className="pm-header">
              <div className="h2h-header">
                <div className="h2h-player h2h-player--1">{data.player1}</div>
                <div className="h2h-vs">vs</div>
                <div className="h2h-player h2h-player--2">{data.player2}</div>
              </div>
            </div>

            {data.records.map((r, i) => (
              <div key={i} className="pm-section h2h-record-section">
                <div className="h2h-record-score">
                  <span className={`h2h-wins${r.winsP1 > r.winsP2 ? ' h2h-wins--leader' : ''}`}>{r.winsP1}</span>
                  <span className="h2h-wins-sep">–</span>
                  <span className={`h2h-wins${r.winsP2 > r.winsP1 ? ' h2h-wins--leader' : ''}`}>{r.winsP2}</span>
                </div>
              </div>
            ))}

            {data.matches.length > 0 && (
              <div className="pm-section">
                <div className="pm-section-title">Match History ({data.matches.length})</div>
                <div className="h2h-matches">
                  {data.matches.map((m, i) => (
                    <div key={i} className="h2h-match">
                      <div className="h2h-match-meta">
                        {m.tournament && <div className="h2h-match-tournament">{m.tournament}</div>}
                        <div className="h2h-match-info">
                          {m.event && <span className="h2h-match-event">{m.event}</span>}
                          {m.round && <span className="h2h-match-round">{m.round}</span>}
                        </div>
                      </div>
                      <div className="h2h-match-result">
                        <span className="h2h-match-player h2h-match-player--1">{data.player1}</span>
                        <span className="h2h-match-score">{scoreStr(m.scores, m.walkover, m.retired)}</span>
                        <span className="h2h-match-player h2h-match-player--2">{data.player2}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {data.records.length === 0 && data.matches.length === 0 && (
              <div className="pm-empty">No H2H data available.</div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
