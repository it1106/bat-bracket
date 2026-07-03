'use client'

import RosterModal, { type RosterRow } from '@/components/RosterModal'
import type { StatsClubRoster } from '@/lib/types'

interface Props {
  roster: StatsClubRoster | null
  onClose: () => void
}

// Lists the players that represent a club and the event(s) each is entered in.
// Opened from the Club / Team section of the BAT stats tab. No age (BAT has no
// per-player age source).
export default function ClubRosterModal({ roster, onClose }: Props) {
  if (!roster) return null

  // Prefer the rich per-player roster; fall back to bare names for stats blobs
  // cached before the `roster` field existed (they still have `members`).
  const rows: RosterRow[] = roster.roster ?? roster.members.map((name) => ({ name, events: [] }))

  return (
    <RosterModal open title={roster.club} count={roster.players} rows={rows} onClose={onClose} />
  )
}
