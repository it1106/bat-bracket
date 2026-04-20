'use client'

import { useEffect, useState } from 'react'
import type { H2HData, H2HMatch } from '@/lib/types'

interface Props {
  data: H2HData | null
  loading: boolean
  onClose: () => void
}

type Filter = 'all' | 'singles' | 'doubles' | 'mixed'

function matchFilter(m: H2HMatch, filter: Filter): boolean {
  if (filter === 'all') return true
  const e = m.event.toUpperCase()
  // Singles: MS, WS, BS, GS, or contains "SINGLES"
  if (filter === 'singles') return /^[MWBG]S\b/.test(e) || e.includes('SINGLES')
  // Mixed: XD or contains "MIXED"
  if (filter === 'mixed') return /^XD\b/.test(e) || e.includes('MIXED')
  // Doubles: MD, WD, BD, GD — but NOT mixed
  if (filter === 'doubles') return /^[MWBG]D\b/.test(e) || (e.includes('DOUBLES') && !e.includes('MIXED'))
  return true
}

export default function H2HModal({ data, loading, onClose }: Props) {
  const [filter, setFilter] = useState<Filter>('all')

  useEffect(() => {
    setFilter('all')
  }, [data])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!loading && !data) return null

  const filteredMatches = data ? data.matches.filter((m) => matchFilter(m, filter)) : []

  // For non-"all" filters, compute record from filtered matches using winner field
  let winsP1 = 0, winsP2 = 0
  if (data) {
    if (filter === 'all' && data.records.length > 0) {
      winsP1 = data.records[0].winsP1
      winsP2 = data.records[0].winsP2
    } else {
      filteredMatches.forEach((m) => {
        if (m.winner === 1) winsP1++
        else if (m.winner === 2) winsP2++
      })
    }
  }

  const FILTERS: { key: Filter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'singles', label: 'Singles' },
    { key: 'doubles', label: 'Doubles' },
    { key: 'mixed', label: 'Mixed' },
  ]

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

            <div className="pm-section h2h-record-section">
              <div className="h2h-record-score">
                <span className={`h2h-wins${winsP1 > winsP2 ? ' h2h-wins--leader' : ''}`}>{winsP1}</span>
                <span className="h2h-wins-sep">–</span>
                <span className={`h2h-wins${winsP2 > winsP1 ? ' h2h-wins--leader' : ''}`}>{winsP2}</span>
              </div>

              <div className="h2h-filter-tabs">
                {FILTERS.map(({ key, label }) => (
                  <button
                    key={key}
                    className={`h2h-filter-tab${filter === key ? ' active' : ''}`}
                    onClick={() => setFilter(key)}
                  >{label}</button>
                ))}
              </div>
            </div>

            {filteredMatches.length > 0 && (
              <div className="pm-section">
                <div className="pm-section-title">Match History ({filteredMatches.length})</div>
                <div className="h2h-matches">
                  {filteredMatches.map((m, i) => (
                    <div key={i} className="h2h-match">
                      <div className="h2h-match-meta">
                        {m.tournament && <div className="h2h-match-tournament">{m.tournament}</div>}
                        <div className="h2h-match-info">
                          {m.event && <span className="h2h-match-event">{m.event}</span>}
                          {m.round && <span className="h2h-match-round">{m.round}</span>}
                          {m.date && <span className="h2h-match-date">{m.date}</span>}
                        </div>
                      </div>
                      <div className="h2h-board">
                        <div className="h2h-board-row">
                          <span className="h2h-board-player">{data.player1}</span>
                          {m.walkover
                            ? <span className="h2h-board-badge">{m.winner === 1 ? 'W/O' : ''}</span>
                            : <>{m.scores.map((s, si) => <span key={si} className="h2h-board-set">{s.t1}</span>)}{m.retired && m.winner === 1 && <span className="h2h-board-badge">Ret.</span>}</>
                          }
                        </div>
                        <div className="h2h-board-row">
                          <span className="h2h-board-player">{data.player2}</span>
                          {m.walkover
                            ? <span className="h2h-board-badge">{m.winner === 2 ? 'W/O' : ''}</span>
                            : <>{m.scores.map((s, si) => <span key={si} className="h2h-board-set">{s.t2}</span>)}{m.retired && m.winner === 2 && <span className="h2h-board-badge">Ret.</span>}</>
                          }
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {filteredMatches.length === 0 && (
              <div className="pm-empty">
                {data.matches.length === 0 ? 'No H2H data available.' : 'No matches for this discipline.'}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
