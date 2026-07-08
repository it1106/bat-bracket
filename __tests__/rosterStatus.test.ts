import { isActive, isEnded, isMedaled, type RosterStatusMember } from '@/lib/rosterStatus'

const m = (statusByEvent?: Record<string, 'in' | 'out' | 'gold' | 'silver' | 'bronze'>, events?: string[]): RosterStatusMember =>
  ({ events: events ?? Object.keys(statusByEvent ?? {}), statusByEvent })

describe('rosterStatus predicates', () => {
  it('isActive is true while any event is ongoing (missing status ⇒ ongoing)', () => {
    expect(isActive(m({ MS: 'in' }))).toBe(true)
    expect(isActive(m(undefined, ['GD']))).toBe(true) // no status data ⇒ still in
    expect(isActive(m({ MS: 'gold', MD: 'in' }))).toBe(true) // one done, one ongoing
    expect(isActive(m({ MS: 'gold' }))).toBe(false) // finished medalist
    expect(isActive(m({ MS: 'out' }))).toBe(false) // eliminated
    expect(isActive(m(undefined, []))).toBe(false) // no events
  })

  it('isEnded is true only when every event is concluded (and there is at least one)', () => {
    expect(isEnded(m({ MS: 'gold' }))).toBe(true)
    expect(isEnded(m({ MS: 'out', WS: 'silver' }))).toBe(true)
    expect(isEnded(m({ MS: 'gold', MD: 'in' }))).toBe(false) // still playing MD
    expect(isEnded(m({ MS: 'in' }))).toBe(false)
    expect(isEnded(m(undefined, []))).toBe(false) // no events
  })

  it('isMedaled is true when any event yields a medal, even if still playing another', () => {
    expect(isMedaled(m({ MS: 'gold' }))).toBe(true)
    expect(isMedaled(m({ MS: 'silver' }))).toBe(true)
    expect(isMedaled(m({ MS: 'bronze' }))).toBe(true)
    expect(isMedaled(m({ MS: 'gold', MD: 'in' }))).toBe(true)
    expect(isMedaled(m({ MS: 'out' }))).toBe(false)
    expect(isMedaled(m({ MS: 'in' }))).toBe(false)
    expect(isMedaled(m(undefined, ['GD']))).toBe(false)
  })
})
