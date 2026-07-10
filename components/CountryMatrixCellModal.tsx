'use client'

import { useEffect } from 'react'
import { useLanguage } from '@/lib/LanguageContext'
import { countryDisplayName } from '@/lib/countryCodes'
import type { OrientedCellMatch } from '@/lib/countryMatrix'

const label = (code: string) => {
  const name = countryDisplayName(code)
  return name && name.toLowerCase() !== code.toLowerCase() ? `${name} (${code})` : code
}

// Modal listing the individual match score lines behind a clicked matrix cell.
// Matches are pre-oriented so the row country reads first (rowTeam / rowScores).
export default function CountryMatrixCellModal({
  row,
  col,
  matches,
  onClose,
}: {
  row: string
  col: string
  matches: OrientedCellMatch[]
  onClose: () => void
}) {
  const { t, longRound } = useLanguage()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const rowWins = matches.filter((m) => m.rowWon).length
  const colWins = matches.length - rowWins

  return (
    <div className="pm-overlay" onClick={onClose}>
      <div className="pm-modal cmx-modal" onClick={(e) => e.stopPropagation()}>
        <button className="pm-close" onClick={onClose} aria-label={t('close')}>✕</button>
        <div className="cmx-modal-head">
          <h3>{label(row)} <span className="cmx-vs">{t('vs')}</span> {label(col)}</h3>
          <div className="cmx-modal-sub">{rowWins}–{colWins}</div>
        </div>
        <div className="cmx-lines">
          {matches.map((m, i) => (
            <div className="cmx-line" key={i}>
              <div className="cmx-line-meta">
                <span className="cmx-line-draw">{m.draw}</span>
                <span className="cmx-line-round">{longRound(m.round)}</span>
              </div>
              <div className={`cmx-side${m.rowWon ? ' is-win' : ''}`}>
                <span className="cmx-team">{m.rowTeam.join(' / ')}</span>
                <span className="cmx-score">{m.rowScores.map((s, si) => <span key={si}>{s.t1}</span>)}</span>
              </div>
              <div className={`cmx-side${!m.rowWon ? ' is-win' : ''}`}>
                <span className="cmx-team">{m.colTeam.join(' / ')}</span>
                <span className="cmx-score">{m.rowScores.map((s, si) => <span key={si}>{s.t2}</span>)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
