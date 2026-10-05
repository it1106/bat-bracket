import { countryName, countrySlices, percentLabel } from '@/lib/countryDonut'

const c = (country: string, count: number) => ({ country, count })

describe('countrySlices', () => {
  it('is empty when there is nothing to show', () => {
    expect(countrySlices([])).toEqual([])
    expect(countrySlices([c('TH', 0)])).toEqual([])
  })

  it('draws the busiest five and folds the rest into Other', () => {
    const slices = countrySlices([
      c('TH', 900), c('US', 40), c('NL', 30), c('SG', 15), c('JP', 8), c('KR', 4), c('AU', 3),
    ])
    expect(slices.map((s) => s.key)).toEqual(['TH', 'US', 'NL', 'SG', 'JP', 'other'])
    expect(slices[5]).toMatchObject({ name: 'Other (2 countries)', count: 7, slot: 0 })
    expect(slices.reduce((sum, s) => sum + s.percent, 0)).toBeCloseTo(100)
    expect(slices[0].percent).toBeCloseTo(90)
  })

  it('has no Other slice when every country fits', () => {
    expect(countrySlices([c('TH', 5), c('US', 1)]).map((s) => s.key)).toEqual(['TH', 'US'])
  })

  it('gives every slice a colour of its own, Thailand always the first', () => {
    const slices = countrySlices([c('US', 50), c('TH', 40), c('NL', 30), c('SG', 15), c('JP', 8)])
    expect(slices.find((s) => s.key === 'TH')?.slot).toBe(1)
    expect(new Set(slices.map((s) => s.slot)).size).toBe(5)
    expect(slices.every((s) => s.slot >= 1 && s.slot <= 5)).toBe(true)
  })

  it('keeps a country its colour when the order changes', () => {
    const slotsOf = (rows: Array<{ country: string; count: number }>) =>
      Object.fromEntries(countrySlices(rows).map((s) => [s.key, s.slot]))
    const morning = slotsOf([c('TH', 900), c('US', 40), c('NL', 30), c('SG', 15)])
    const evening = slotsOf([c('TH', 900), c('NL', 80), c('SG', 60), c('US', 40)])
    expect(evening).toEqual(morning)
  })
})

describe('countryName', () => {
  it('names countries, and the codes that are not countries', () => {
    expect(countryName('TH')).toBe('Thailand')
    expect(countryName('direct')).toBe('Not through Cloudflare')
    expect(countryName('XX')).toBe('Unknown')
    expect(countryName('T1')).toBe('Tor')
  })
})

describe('percentLabel', () => {
  it('shows a sliver as a sliver', () => {
    expect(percentLabel(95.234)).toBe('95.2%')
    expect(percentLabel(0.04)).toBe('<0.1%')
    expect(percentLabel(100)).toBe('100%')
    expect(percentLabel(0)).toBe('0.0%')
  })
})
