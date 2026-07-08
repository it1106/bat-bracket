import type { ChipStatus } from './types'

// Minimal shape shared by roster members (StatsClubMember / StatsCountryMember)
// and the modal's RosterRow: the event list plus per-event result status.
export interface RosterStatusMember {
  events: string[]
  statusByEvent?: Record<string, ChipStatus>
}

// Missing status ⇒ 'in' (the same default the roster chips render with).
const statusOf = (m: RosterStatusMember, event: string): ChipStatus =>
  m.statusByEvent?.[event] ?? 'in'

// Still competing: at least one event is ongoing.
export function isActive(m: RosterStatusMember): boolean {
  return m.events.some((e) => statusOf(m, e) === 'in')
}

// Every event concluded — whether eliminated or medaled. Requires ≥1 event.
export function isEnded(m: RosterStatusMember): boolean {
  return m.events.length > 0 && !isActive(m)
}

// Won a medal in any event, even while still playing another.
export function isMedaled(m: RosterStatusMember): boolean {
  return m.events.some((e) => {
    const s = statusOf(m, e)
    return s === 'gold' || s === 'silver' || s === 'bronze'
  })
}
