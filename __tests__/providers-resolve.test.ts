import { providerFor } from '@/lib/providers/resolve'

describe('providerFor', () => {
  it('returns bat provider for bat ref', () => {
    const p = providerFor({ id: 'X', provider: 'bat' })
    expect(p.tag).toBe('bat')
  })

  it('returns bwf provider for bwf ref', () => {
    const p = providerFor({ id: 'Y', provider: 'bwf' })
    expect(p.tag).toBe('bwf')
  })
})
