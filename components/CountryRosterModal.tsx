'use client'

import { useEffect, useState } from 'react'
import { useLanguage } from '@/lib/LanguageContext'
import { countryDisplayName } from '@/lib/countryCodes'
import { formatDob } from '@/lib/age'
import RosterModal, { type RosterRow } from '@/components/RosterModal'
import type { StatsCountryRoster } from '@/lib/types'
import { fetchBwfAges } from '@/lib/bwfAgesClient'

interface Props {
  roster: StatsCountryRoster | null
  onClose: () => void
}

interface AgeInfo { age: number | null; dob: string | null }

// Lists the players that represent a country and the event(s) each is entered
// in, with age + a date-of-birth hover tooltip. Opened from the Country section
// of the BWF stats tab. Ages are fetched lazily from BWF when the modal opens.
export default function CountryRosterModal({ roster, onClose }: Props) {
  const { lang } = useLanguage()
  const [ages, setAges] = useState<Record<string, AgeInfo>>({})

  // Lazily fetch ages (date-of-birth) for this country's players when the modal
  // opens. Cached server-side forever, so repeat opens resolve instantly.
  useEffect(() => {
    setAges({})
    if (!roster?.roster) return
    const ids = roster.roster.map((m) => m.playerId).filter((id): id is string => !!id)
    if (ids.length === 0) return
    let cancelled = false
    // In batches: the server looks up only so many unknown players a request,
    // and fetchBwfAges asks again for the rest. A failure leaves ages empty —
    // names still render.
    void fetchBwfAges(ids, {
      cancelled: () => cancelled,
      onBatch: (data) => setAges((prev) => ({ ...prev, ...data })),
    })
    return () => { cancelled = true }
  }, [roster])

  if (!roster) return null

  // Prefer the rich per-player roster; fall back to bare names for stats blobs
  // cached before the `roster` field existed (they still have `members`).
  const rows: RosterRow[] = roster.roster
    ? roster.roster.map((m) => ({ name: m.name, playerId: m.playerId, events: m.events, statusByEvent: m.statusByEvent, results: m.results }))
    : roster.members.map((name) => ({ name, events: [] }))
  const name = countryDisplayName(roster.country)
  const title = name && name.toLowerCase() !== roster.country.toLowerCase()
    ? `${name} (${roster.country})`
    : roster.country

  const ageOf = (r: RosterRow) => (r.playerId ? ages[r.playerId] : undefined)

  return (
    <RosterModal
      open
      title={title}
      count={roster.players}
      rows={rows}
      onClose={onClose}
      nameSuffix={(r) => {
        const info = ageOf(r)
        return info?.age != null ? <span className="country-roster-age"> ({info.age})</span> : null
      }}
      nameTitle={(r) => {
        const info = ageOf(r)
        return info?.dob ? formatDob(info.dob, lang) : undefined
      }}
    />
  )
}
