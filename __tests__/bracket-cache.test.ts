jest.mock('../lib/providers/resolve', () => ({ providerFor: jest.fn() }))
jest.mock('../lib/tournaments-registry', () => ({
  resolveRef: jest.fn((id: string) => ({ id: id.toUpperCase(), provider: 'bwf' })),
}))

import { cache as bracketCache, fetchAndCache, makeBracketKey } from '../lib/bracket-cache'
import { cache as drawsCache } from '../lib/draws-cache'
import { providerFor } from '../lib/providers/resolve'

describe('bracket-cache done inheritance', () => {
  beforeEach(() => {
    bracketCache.clear()
    drawsCache.clear()
    ;(providerFor as jest.Mock).mockReset()
    ;(providerFor as jest.Mock).mockReturnValue({
      getBracket: jest.fn().mockResolvedValue({ html: '<div></div>', format: 'single-elimination' }),
    })
  })

  it('inherits done from draws-cache regardless of guid casing', async () => {
    // draws-cache keys are canonical upper-case; the bracket route lower-cases
    // the guid before it reaches here.
    drawsCache.set('6E65C36E-AAAA', { draws: [], ts: Date.now(), done: true })
    await fetchAndCache('6e65c36e-aaaa', '1')
    expect(bracketCache.get(makeBracketKey('6e65c36e-aaaa', '1'))?.done).toBe(true)
  })
})

describe('feederLookupCache', () => {
  it('exposes a globalThis-backed Map shared across imports', () => {
    const { feederLookupCache } = require('../lib/bracket-cache')
    expect(feederLookupCache).toBeInstanceOf(Map)
  })

  it('round-trips a per-draw feeder lookup', () => {
    const { feederLookupCache } = require('../lib/bracket-cache')
    const childMatches = [
      [[{ name: 'A1', playerId: '11' }]],
      [[{ name: 'B1', playerId: '21' }]],
    ]
    const lookup = new Map([['11,21', childMatches]])
    feederLookupCache.set('TID:1', { lookup, ts: 12345 })
    const got = feederLookupCache.get('TID:1')
    expect(got?.ts).toBe(12345)
    expect(got?.lookup.get('11,21')).toEqual(childMatches)
    feederLookupCache.delete('TID:1')
  })
})
