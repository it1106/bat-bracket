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
