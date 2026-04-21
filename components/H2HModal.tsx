'use client'

import { useEffect, useState } from 'react'
import type { H2HData, H2HMatch } from '@/lib/types'
import { useLanguage } from '@/lib/LanguageContext'

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
  const { t, longRound } = useLanguage()
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

  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()
  const sideOf = (name: string, m: H2HMatch): 1 | 2 | null => {
    const n = norm(name)
    if (!n) return null
    if (m.team1.some((x) => norm(x) === n)) return 1
    if (m.team2.some((x) => norm(x) === n)) return 2
    if (m.team1.some((x) => norm(x).includes(n) || n.includes(norm(x)))) return 1
    if (m.team2.some((x) => norm(x).includes(n) || n.includes(norm(x)))) return 2
    return null
  }

  let winsP1 = 0, winsP2 = 0
  filteredMatches.forEach((m) => {
    if (m.winner === null) return
    const p1Side = data ? sideOf(data.player1, m) : null
    const p2Side = data ? sideOf(data.player2, m) : null
    const p1Won = p1Side !== null ? m.winner === p1Side : null
    const p2Won = p2Side !== null ? m.winner === p2Side : null
    if (p1Won === true) winsP1++
    else if (p2Won === true) winsP2++
    else if (p1Won === false) winsP2++
    else if (p2Won === false) winsP1++
    else {
      if (m.winner === 1) winsP1++
      else winsP2++
    }
  })

  const FILTERS: { key: Filter; label: string }[] = [
    { key: 'all', label: t('filterAll') },
    { key: 'singles', label: t('filterSingles') },
    { key: 'doubles', label: t('filterDoubles') },
    { key: 'mixed', label: t('filterMixed') },
  ]

  return (
    <div className="pm-overlay" onClick={onClose}>
      <div className="pm-modal h2h-modal" onClick={(e) => e.stopPropagation()}>
        <button className="pm-close" onClick={onClose} aria-label={t('close')}>✕</button>

        {loading && <div className="pm-loading">{t('loadingH2H')}</div>}

        {!loading && data && (
          <>
            <div className="pm-header">
              <div className="h2h-header">
                <div className="h2h-player h2h-player--1">
                  {data.player1.split(' & ').map((n, i) => <div key={i}>{n}</div>)}
                </div>
                <div className="h2h-vs">{t('vs')}</div>
                <div className="h2h-player h2h-player--2">
                  {data.player2.split(' & ').map((n, i) => <div key={i}>{n}</div>)}
                </div>
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
                <div className="pm-section-title">{t('matchHistory')} ({filteredMatches.length})</div>
                <div className="h2h-matches">
                  {filteredMatches.map((m, i) => (
                    <div key={i} className="h2h-match">
                      <div className="h2h-match-meta">
                        {m.tournament && <div className="h2h-match-tournament">{m.tournament}</div>}
                        <div className="h2h-match-info">
                          {m.event && <span className="h2h-match-event">{m.event}</span>}
                          {m.round && <span className="h2h-match-round">{longRound(m.round)}</span>}
                          {m.date && <span className="h2h-match-date">{m.date}</span>}
                        </div>
                      </div>
                      <div className="h2h-board">
                        <div className={`h2h-board-row${m.winner === 1 ? ' winner' : ''}`}>
                          <span className="h2h-board-player">
                            {(m.team1.length > 0 ? m.team1 : [data.player1]).join(' / ')}
                          </span>
                          {m.walkover
                            ? <span className="h2h-board-badge">{m.winner === 1 ? 'W/O' : ''}</span>
                            : <>{m.scores.map((s, si) => <span key={si} className="h2h-board-set">{s.t1}</span>)}{m.retired && m.winner === 1 && <span className="h2h-board-badge">{t('retired')}</span>}</>
                          }
                        </div>
                        <div className={`h2h-board-row${m.winner === 2 ? ' winner' : ''}`}>
                          <span className="h2h-board-player">
                            {(m.team2.length > 0 ? m.team2 : [data.player2]).join(' / ')}
                          </span>
                          {m.walkover
                            ? <span className="h2h-board-badge">{m.winner === 2 ? 'W/O' : ''}</span>
                            : <>{m.scores.map((s, si) => <span key={si} className="h2h-board-set">{s.t2}</span>)}{m.retired && m.winner === 2 && <span className="h2h-board-badge">{t('retired')}</span>}</>
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
                {data.matches.length === 0 ? t('noH2HData') : t('noH2HDiscipline')}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
