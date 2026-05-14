import type { EventBundle } from '../lib/types'

jest.mock('../lib/providers/resolve', () => ({
  providerFor: jest.fn(),
}))
jest.mock('../lib/tournaments-registry', () => ({
  resolveRef: jest.fn(() => ({ id: 'GUID', provider: 'bat' })),
}))
jest.mock('../lib/draws-cache', () => ({
  cache: new Map(),
}))

import { cache, makeKey, fetchAndCache, TTL_MS } from '../lib/event-bundle-cache'
import { providerFor } from '../lib/providers/resolve'

const fakeBundle: EventBundle = {
  eventName: 'BS U11',
  playoff: { html: '', format: 'single-elimination' },
  playoffDrawNum: '9',
  groups: [],
}

describe('event-bundle-cache', () => {
  beforeEach(() => {
    cache.clear()
    ;(providerFor as jest.Mock).mockReset()
    ;(providerFor as jest.Mock).mockReturnValue({
      getEventBundle: jest.fn().mockResolvedValue(fakeBundle),
    })
  })

  it('makeKey is deterministic per tournament+event', () => {
    expect(makeKey('guid', 'BS U11')).toBe(makeKey('guid', 'BS U11'))
    expect(makeKey('guid', 'BS U11')).not.toBe(makeKey('guid', 'GS U11'))
  })

  it('TTL matches bracket-cache (15 minutes)', () => {
    expect(TTL_MS).toBe(15 * 60 * 1000)
  })

  it('fetchAndCache stores the bundle keyed by tournament+event', async () => {
    const out = await fetchAndCache('guid', 'BS U11')
    expect(out).toEqual(fakeBundle)
    expect(cache.get(makeKey('guid', 'BS U11'))?.bundle).toEqual(fakeBundle)
  })

  it('fetchAndCache marks done=true if draws-cache has done flag', async () => {
    const drawsCache = (await import('../lib/draws-cache')).cache
    drawsCache.set('guid', { draws: [], ts: Date.now(), done: true })
    await fetchAndCache('guid', 'BS U11')
    expect(cache.get(makeKey('guid', 'BS U11'))?.done).toBe(true)
  })
})
