import { isActive, isMedaled, type RosterStatusMember } from './rosterStatus'

export type RosterSortCol = 'name' | 'players' | 'active' | 'activePct' | 'medaled' | 'medaledPct'
export interface RosterSort {
  col: RosterSortCol
  dir: 'asc' | 'desc'
}

// Sort a list of club/country roster rows by a chosen column. `name` sorts by
// the caller-supplied label (country code or club name); the numeric columns
// derive their value from the row (players) or its per-player status (active /
// medaled counts). Returns a new array (input is never mutated); JS's stable
// sort preserves the incoming order for ties, so the default ranking survives
// under an equal-value sort.
export function sortRosterRows<T extends { players: number; roster?: RosterStatusMember[] }>(
  rows: T[],
  nameOf: (row: T) => string,
  sort: RosterSort | null,
): T[] {
  if (!sort) return rows
  const valueOf = (row: T): string | number => {
    switch (sort.col) {
      case 'name': return nameOf(row)
      case 'players': return row.players
      case 'active': return (row.roster ?? []).filter(isActive).length
      case 'activePct': {
        // Share of the roster still competing (matches the displayed %).
        const r = row.roster ?? []
        return r.length > 0 ? r.filter(isActive).length / r.length : 0
      }
      case 'medaled': return (row.roster ?? []).filter(isMedaled).length
      case 'medaledPct': {
        // Share of the roster that medaled (matches the displayed %).
        const r = row.roster ?? []
        return r.length > 0 ? r.filter(isMedaled).length / r.length : 0
      }
    }
  }
  const sorted = [...rows].sort((a, b) => {
    const va = valueOf(a)
    const vb = valueOf(b)
    const cmp = typeof va === 'string' ? va.localeCompare(String(vb)) : (va as number) - (vb as number)
    return sort.dir === 'asc' ? cmp : -cmp
  })
  return sorted
}
