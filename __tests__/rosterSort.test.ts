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

  it('sorts by medaled percentage (medaled / roster size), distinct from raw count', () => {
    // THA medaled 1/3 (0.33), MAS 1/1 (1.00), INA 0/5 (0).
    // By raw count THA (1) ties MAS (1) and stays first (stable)…
    expect(sortRosterRows(rows, nameOf, { col: 'medaled', dir: 'desc' }).map((r) => r.country)).toEqual(['THA', 'MAS', 'INA'])
    // …but by percentage MAS (100%) outranks THA (33%).
    expect(sortRosterRows(rows, nameOf, { col: 'medaledPct', dir: 'desc' }).map((r) => r.country)).toEqual(['MAS', 'THA', 'INA'])
  })

  it('sorts by active percentage (active / roster size), distinct from raw count', () => {
    const ins = (n: number) => Array.from({ length: n }, () => m('in'))
    const outs = (n: number) => Array.from({ length: n }, () => m('out'))
    const r: Row[] = [
      { country: 'BIG', players: 10, roster: [...ins(3), ...outs(7)] },   // count 3, pct 0.30
      { country: 'SMALL', players: 2, roster: [...ins(2)] },              // count 2, pct 1.00
    ]
    // By raw active count, BIG (3) outranks SMALL (2)…
    expect(sortRosterRows(r, nameOf, { col: 'active', dir: 'desc' }).map((c) => c.country)).toEqual(['BIG', 'SMALL'])
    // …but by active percentage, SMALL (100%) outranks BIG (30%).
    expect(sortRosterRows(r, nameOf, { col: 'activePct', dir: 'desc' }).map((c) => c.country)).toEqual(['SMALL', 'BIG'])
  })

  it('does not mutate the input array', () => {
    const before = rows.map((r) => r.country)
    sortRosterRows(rows, nameOf, { col: 'players', dir: 'asc' })
    expect(rows.map((r) => r.country)).toEqual(before)
  })
})
