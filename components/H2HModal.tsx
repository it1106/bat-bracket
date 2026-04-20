'use client'

import { useEffect, useMemo } from 'react'
import type { H2HData, MatchScore } from '@/lib/types'

interface Props {
  data: H2HData | null
  loading: boolean
  drawName?: string  // e.g. "BS U15" — used to filter discipline record
  onClose: () => void
}

function scoreStr(scores: MatchScore[], walkover: boolean, retired: boolean): string {
  if (walkover) return 'Walkover'
  if (scores.length === 0) return '—'
  const s = scores.map((s) => `${s.t1}–${s.t2}`).join(', ')
  return retired ? `${s} Ret.` : s
}

function discipline(draw: string): 'singles' | 'doubles' | 'mixed' | null {
  const d = draw.toUpperCase()
  if (/^(BS|GS|MS|WS|BD|GD|MD|WD|XD)/.test(d)) {
    if (d.startsWith('XD')) return 'mixed'
    if (d.startsWith('BD') || d.startsWith('GD') || d.startsWith('MD') || d.startsWith('WD')) return 'doubles'
    return 'singles'
  }
  return null
}

function matchDiscipline(event: string): 'singles' | 'doubles' | 'mixed' | null {
  return discipline(event.trim().split(' ')[0])
}

export default function H2HModal({ data, loading, drawName, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const currentDiscipline = drawName ? discipline(drawName.trim().split(' ')[0]) : null

  const filteredRecord = useMemo(() => {
    if (!data || !currentDiscipline) return null
    let w1 = 0, w2 = 0
    data.matches.forEach(m => {
      if (matchDiscipline(m.event) === currentDiscipline && m.winner !== null) {
        if (m.winner === 1) w1++; else w2++
      }
    })
    return { winsP1: w1, winsP2: w2 }
  }, [data, currentDiscipline])

  const disciplineLabel = currentDiscipline
    ? currentDiscipline.charAt(0).toUpperCase() + currentDiscipline.slice(1)
    : null

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

            <div className="pm-section">
              {/* Discipline-specific record */}
              {filteredRecord && (
                <div className="h2h-record">
                  <div className="h2h-record-category">{disciplineLabel}</div>
                  <div className="h2h-record-score">
                    <span className={`h2h-wins${filteredRecord.winsP1 > filteredRecord.winsP2 ? ' h2h-wins--leader' : ''}`}>{filteredRecord.winsP1}</span>
                    <span className="h2h-wins-sep">–</span>
                    <span className={`h2h-wins${filteredRecord.winsP2 > filteredRecord.winsP1 ? ' h2h-wins--leader' : ''}`}>{filteredRecord.winsP2}</span>
                  </div>
                </div>
              )}
              {/* Overall record */}
              {data.records.map((r, i) => (
                <div key={i} className="h2h-record h2h-record--overall">
                  <div className="h2h-record-category">Overall</div>
                  <div className="h2h-record-score h2h-record-score--overall">
                    <span className={`h2h-wins${r.winsP1 > r.winsP2 ? ' h2h-wins--leader' : ''}`}>{r.winsP1}</span>
                    <span className="h2h-wins-sep">–</span>
                    <span className={`h2h-wins${r.winsP2 > r.winsP1 ? ' h2h-wins--leader' : ''}`}>{r.winsP2}</span>
                  </div>
                </div>
              ))}
            </div>

            {data.matches.length > 0 && (
              <div className="pm-section">
                <div className="pm-section-title">Past Matches</div>
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
                        <span className={`h2h-match-player${m.winner === 1 ? ' winner' : ''}`}>{data.player1}</span>
                        <span className="h2h-match-score">{scoreStr(m.scores, m.walkover, m.retired)}</span>
                        <span className={`h2h-match-player${m.winner === 2 ? ' winner' : ''}`}>{data.player2}</span>
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
