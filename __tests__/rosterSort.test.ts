import { sortRosterRows, type RosterSort } from '@/lib/rosterSort'
import type { RosterStatusMember } from '@/lib/rosterStatus'

type Row = { country: string; players: number; roster?: RosterStatusMember[] }

// events with default 'in' status ⇒ active; 'out' ⇒ inactive; medal ⇒ medaled.
const m = (status?: 'in' | 'out' | 'gold'): RosterStatusMember => ({
  events: ['E'],
  statusByEvent: status ? { E: status } : undefined,
})

const rows: Row[] = [
  { country: 'THA', players: 3, roster: [m('in'), m('out'), m('gold')] }, // active 1, medaled 1
  { country: 'INA', players: 5, roster: [m('in'), m('in'), m('out'), m('out'), m('out')] }, // active 2, medaled 0
  { country: 'MAS', players: 1, roster: [m('gold')] }, // active 0, medaled 1
]
const nameOf = (r: Row) => r.country

describe('sortRosterRows', () => {
  it('returns the input order unchanged when no sort is set', () => {
    expect(sortRosterRows(rows, nameOf, null).map((r) => r.country)).toEqual(['THA', 'INA', 'MAS'])
  })

  it('sorts by players ascending / descending', () => {
    const asc: RosterSort = { col: 'players', dir: 'asc' }
    expect(sortRosterRows(rows, nameOf, asc).map((r) => r.players)).toEqual([1, 3, 5])
    const desc: RosterSort = { col: 'players', dir: 'desc' }
    expect(sortRosterRows(rows, nameOf, desc).map((r) => r.players)).toEqual([5, 3, 1])
  })

  it('sorts by name alphabetically', () => {
    expect(sortRosterRows(rows, nameOf, { col: 'name', dir: 'asc' }).map((r) => r.country)).toEqual(['INA', 'MAS', 'THA'])
  })

  it('sorts by active count (derived from roster status; a medal is not "active")', () => {
    // active: INA 2, THA 1, MAS 0.
    expect(sortRosterRows(rows, nameOf, { col: 'active', dir: 'desc' }).map((r) => r.country)).toEqual(['INA', 'THA', 'MAS'])
    expect(sortRosterRows(rows, nameOf, { col: 'active', dir: 'asc' }).map((r) => r.country)).toEqual(['MAS', 'THA', 'INA'])
  })

  it('sorts by medaled count', () => {
    expect(sortRosterRows(rows, nameOf, { col: 'medaled', dir: 'desc' }).map((r) => r.country)).toEqual(['THA', 'MAS', 'INA'])
  })

  it('does not mutate the input array', () => {
    const before = rows.map((r) => r.country)
    sortRosterRows(rows, nameOf, { col: 'players', dir: 'asc' })
    expect(rows.map((r) => r.country)).toEqual(before)
  })
})
