import { schedulePollUrl } from '@/lib/schedulePoll'

describe('schedulePollUrl', () => {
  it('builds a cached (non-fresh) day URL for a real day', () => {
    expect(schedulePollUrl('ABC-123', '2026-07-10'))
      .toBe('/api/matches?tournament=ABC-123&date=2026-07-10')
  })

  it('does not include fresh=1 (relies on the server memcache — gentle on load)', () => {
    expect(schedulePollUrl('ABC-123', '2026-07-10')).not.toContain('fresh')
  })

  it('encodes the tournament id', () => {
    expect(schedulePollUrl('a b/c', '2026-07-10')).toContain('tournament=a%20b%2Fc')
  })

  it('returns null when there is nothing to poll (no tournament / no day / stats tab)', () => {
    expect(schedulePollUrl('', '2026-07-10')).toBeNull()
    expect(schedulePollUrl('ABC-123', '')).toBeNull()
    expect(schedulePollUrl('ABC-123', 'stats')).toBeNull()
  })
})
