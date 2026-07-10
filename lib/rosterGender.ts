import type { StatsCountryRoster } from './types'

export type RosterGender = 'male' | 'female'

// A player's gender from their event codes: a boys'/men's event (B*/M*) ⇒ male,
// a girls'/women's event (G*/W*) ⇒ female. Mixed-only players (just XD) have no
// singular gender and return null (excluded from a gendered view).
export function memberGender(events: string[]): RosterGender | null {
  for (const e of events) {
    const c = e.trim()[0]?.toUpperCase()
    if (c === 'B' || c === 'M') return 'male'
    if (c === 'G' || c === 'W') return 'female'
  }
  return null
}

// Filter each country's roster to members of one gender, recomputing the
// players count + members list so the table's counts (players/active/medaled,
// all derived from `roster`) reflect the filtered set. Countries with no member
// of that gender drop out. Rows without a per-player `roster` (older cached
// blobs) can't be filtered and are kept as-is. Never mutates the input.
export function filterCountryRostersByGender(
  rosters: StatsCountryRoster[],
  gender: RosterGender | 'all',
): StatsCountryRoster[] {
  if (gender === 'all') return rosters
  const out: StatsCountryRoster[] = []
  for (const c of rosters) {
    if (!c.roster) { out.push(c); continue }
    const members = c.roster.filter((m) => memberGender(m.events) === gender)
    if (members.length === 0) continue
    out.push({ ...c, roster: members, members: members.map((m) => m.name), players: members.length })
  }
  return out
}
