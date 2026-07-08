'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLanguage } from '@/lib/LanguageContext'
import type { ChipStatus } from '@/lib/types'
import { isActive, isEnded, isMedaled } from '@/lib/rosterStatus'

export interface RosterRow {
  name: string
  events: string[]
  playerId?: string
  // Per-event result keyed by the same strings in `events`. Missing ⇒ 'in'.
  statusByEvent?: Record<string, ChipStatus>
}

interface Props {
  // Non-null while open. When null the modal renders nothing.
  open: boolean
  title: ReactNode
  count: number
  rows: RosterRow[]
  onClose: () => void
  // Optional per-row adornments (used by the country modal for age/DOB).
  nameSuffix?: (row: RosterRow) => ReactNode
  nameTitle?: (row: RosterRow) => string | undefined
}

// Shared body for the club and country roster modals: the pm-overlay/pm-modal
// shell, a name/event filter box, and the player list. Each caller supplies the
// title and rows; the country modal additionally passes per-row age adornments.
export default function RosterModal({ open, title, count, rows, onClose, nameSuffix, nameTitle }: Props) {
  const { t } = useLanguage()
  const [query, setQuery] = useState('')
  const [showActive, setShowActive] = useState(false)
  const [showEnded, setShowEnded] = useState(false)
  const [showMedaled, setShowMedaled] = useState(false)

  // Reset the filters whenever the modal is (re)opened.
  useEffect(() => {
    if (open) { setQuery(''); setShowActive(false); setShowEnded(false); setShowMedaled(false) }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Active/Ended/Medaled definitions live in lib/rosterStatus (shared with the
  // country/club summary counts). Each checked category adds its group (union);
  // none checked shows everyone.
  const anyStatusFilter = showActive || showEnded || showMedaled
  const matchesStatus = (r: RosterRow) =>
    !anyStatusFilter ||
    (showActive && isActive(r)) ||
    (showEnded && isEnded(r)) ||
    (showMedaled && isMedaled(r))

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter((r) => {
      if (!matchesStatus(r)) return false
      if (!q) return true
      return r.name.toLowerCase().includes(q) || r.events.some((e) => e.toLowerCase().includes(q))
    })
  }, [rows, query, showActive, showEnded, showMedaled])

  // Headline count reflects the category union (total when none checked) but not
  // the text search, which is a lookup.
  const displayedCount = useMemo(
    () => (anyStatusFilter ? rows.filter(matchesStatus).length : count),
    [rows, count, anyStatusFilter, showActive, showEnded, showMedaled],
  )

  if (!open) return null

  return (
    <div className="pm-overlay" onClick={onClose}>
      <div className="pm-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <button className="pm-close" onClick={onClose} aria-label={t('close')}>✕</button>
        <div className="pm-header">
          <div className="pm-section-title">
            {title} · {displayedCount} {t('statsColPlayers')}
          </div>
        </div>

        <div className="pm-section">
          <input
            type="text"
            className="roster-filter-input"
            placeholder={t('rosterFilterPlaceholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
        </div>

        <div className="pm-section roster-filter-row">
          <label className="roster-status-toggle">
            <input type="checkbox" checked={showActive} onChange={(e) => setShowActive(e.target.checked)} />
            {t('rosterFilterActive')}
          </label>
          <label className="roster-status-toggle">
            <input type="checkbox" checked={showEnded} onChange={(e) => setShowEnded(e.target.checked)} />
            {t('rosterFilterEnded')}
          </label>
          <label className="roster-status-toggle">
            <input type="checkbox" checked={showMedaled} onChange={(e) => setShowMedaled(e.target.checked)} />
            {t('rosterFilterMedaled')}
          </label>
        </div>

        <div className="pm-section" style={{ maxHeight: '55vh', overflowY: 'auto' }}>
          {filtered.length === 0 ? (
            <div className="country-roster-empty" style={{ padding: '8px 4px' }}>{t('rosterNoMatches')}</div>
          ) : (
            <ul className="country-roster-list">
              {filtered.map((r, i) => (
                <li className="country-roster-row" key={`${i}-${r.name}`}>
                  <span className="country-roster-name" title={nameTitle?.(r) || undefined}>
                    {r.name}
                    {nameSuffix?.(r)}
                  </span>
                  <span className="country-roster-events">
                    {r.events.length > 0
                      ? r.events.map((e) => {
                          const status: ChipStatus = r.statusByEvent?.[e] ?? 'in'
                          return (
                            <span className={`country-roster-chip country-roster-chip--${status}`} key={e}>{e}</span>
                          )
                        })
                      : <span className="country-roster-empty">{t('statsCountryNoEvents')}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
