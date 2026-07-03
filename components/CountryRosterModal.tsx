'use client'

import { useEffect, useState } from 'react'
import { useLanguage } from '@/lib/LanguageContext'
import { countryDisplayName } from '@/lib/countryCodes'
import { formatDob } from '@/lib/age'
import type { StatsCountryRoster } from '@/lib/types'

interface Props {
  roster: StatsCountryRoster | null
  onClose: () => void
}

interface AgeInfo { age: number | null; dob: string | null }

// Lists the players that represent a country and the event(s) each is entered
// in. Opened from the Country section of the BWF stats tab. Mirrors the
// pm-overlay/pm-modal shell used by the other modals (Escape + click-outside).
export default function CountryRosterModal({ roster, onClose }: Props) {
  const { t } = useLanguage()
  const [ages, setAges] = useState<Record<string, AgeInfo>>({})

  useEffect(() => {
    if (!roster) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [roster, onClose])

  // Lazily fetch ages (date-of-birth) for this country's players when the modal
  // opens. Cached server-side forever, so repeat opens resolve instantly.
  useEffect(() => {
    setAges({})
    if (!roster?.roster) return
    const ids = roster.roster.map((m) => m.playerId).filter((id): id is string => !!id)
    if (ids.length === 0) return
    let cancelled = false
    fetch(`/api/bwf/player-ages?ids=${encodeURIComponent(ids.join(','))}`)
      .then((r) => (r.ok ? r.json() : {}))
      .then((data: Record<string, AgeInfo>) => { if (!cancelled) setAges(data) })
      .catch(() => { /* leave ages empty — names still render */ })
    return () => { cancelled = true }
  }, [roster])

  if (!roster) return null

  // Prefer the rich per-player roster; fall back to bare names for stats blobs
  // cached before the `roster` field existed (they still have `members`).
  const rows = roster.roster ?? roster.members.map((name) => ({ name, events: [] as string[], playerId: undefined }))
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
            {rows.map((r, i) => {
              const info = r.playerId ? ages[r.playerId] : undefined
              const dobTip = info?.dob ? formatDob(info.dob) : ''
              return (
              <li className="country-roster-row" key={`${i}-${r.name}`}>
                <span className="country-roster-name" title={dobTip || undefined}>
                  {r.name}
                  {info?.age != null && <span className="country-roster-age"> ({info.age})</span>}
                </span>
                <span className="country-roster-events">
                  {r.events.length > 0
                    ? r.events.map((e) => (
                        <span className="country-roster-chip" key={e}>{e}</span>
                      ))
                    : <span className="country-roster-empty">{t('statsCountryNoEvents')}</span>}
                </span>
              </li>
              )
            })}
          </ul>
        </div>
      </div>
    </div>
  )
}
