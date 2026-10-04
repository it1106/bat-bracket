import { staleHeaders } from '@/lib/stale-headers'
import { recordBatOutcome } from '@/lib/bat-outages'

describe('staleHeaders', () => {
  afterEach(() => jest.useRealTimers())

  it('marks the response stale, and names the outage start once BAT is counted as down', () => {
    jest.useFakeTimers()
    const start = Date.parse('2026-10-04T16:31:21.000Z')
    jest.setSystemTime(start)
    expect(staleHeaders()).toEqual({ 'Cache-Control': 'no-store', 'X-Stale-Cache': '1' })

    for (let i = 0; i < 6; i++) {
      jest.setSystemTime(start + i * 10_000)
      recordBatOutcome(500)
    }
    expect(staleHeaders()).toEqual({
      'Cache-Control': 'no-store',
      'X-Stale-Cache': '1',
      'X-Bat-Down-Since': '2026-10-04T16:31:21.000Z',
    })

    for (let i = 0; i < 3; i++) recordBatOutcome(200)
    expect(staleHeaders()['X-Bat-Down-Since']).toBeUndefined()
  })
})
