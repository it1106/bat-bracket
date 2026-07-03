'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLanguage } from '@/lib/LanguageContext'

export interface RosterRow {
  name: string
  events: string[]
  playerId?: string
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

  // Reset the filter whenever the modal is (re)opened.
  useEffect(() => { if (open) setQuery('') }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) =>
      r.name.toLowerCase().includes(q) || r.events.some((e) => e.toLowerCase().includes(q)),
    )
  }, [rows, query])

  if (!open) return null

  return (
    <div className="pm-overlay" onClick={onClose}>
      <div className="pm-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <button className="pm-close" onClick={onClose} aria-label={t('close')}>✕</button>
        <div className="pm-header">
          <div className="pm-section-title">
            {title} · {count} {t('statsColPlayers')}
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
                      ? r.events.map((e) => (
                          <span className="country-roster-chip" key={e}>{e}</span>
                        ))
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
