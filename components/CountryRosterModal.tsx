'use client'

import { useEffect } from 'react'
import { useLanguage } from '@/lib/LanguageContext'
import { countryDisplayName } from '@/lib/countryCodes'
import type { StatsCountryRoster } from '@/lib/types'

interface Props {
  roster: StatsCountryRoster | null
  onClose: () => void
}

// Lists the players that represent a country and the event(s) each is entered
// in. Opened from the Country section of the BWF stats tab. Mirrors the
// pm-overlay/pm-modal shell used by the other modals (Escape + click-outside).
export default function CountryRosterModal({ roster, onClose }: Props) {
  const { t } = useLanguage()

  useEffect(() => {
    if (!roster) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [roster, onClose])

  if (!roster) return null

  // Prefer the rich per-player roster; fall back to bare names for stats blobs
  // cached before the `roster` field existed (they still have `members`).
  const rows = roster.roster ?? roster.members.map((name) => ({ name, events: [] as string[] }))
  const name = countryDisplayName(roster.country)
  const title = name && name.toLowerCase() !== roster.country.toLowerCase()
    ? `${name} (${roster.country})`
    : roster.country

  return (
    <div className="pm-overlay" onClick={onClose}>
      <div className="pm-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <button className="pm-close" onClick={onClose} aria-label={t('close')}>✕</button>
        <div className="pm-header">
          <div className="pm-section-title">
            {title} · {roster.players} {t('statsColPlayers')}
          </div>
        </div>

        <div className="pm-section" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
          <ul className="country-roster-list">
            {rows.map((r, i) => (
              <li className="country-roster-row" key={`${i}-${r.name}`}>
                <span className="country-roster-name">{r.name}</span>
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
        </div>
      </div>
    </div>
  )
}
