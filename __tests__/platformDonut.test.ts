import { platformName, platformSlices } from '@/lib/platformDonut'
import { UNKNOWN_PLATFORM } from '@/lib/presence'

const p = (platform: string, count: number) => ({ platform, count })

describe('platformSlices', () => {
  it('is empty when there is nothing to show', () => {
    expect(platformSlices([])).toEqual([])
    expect(platformSlices([p('iOS', 0)])).toEqual([])
  })

  it('gives every platform a slice, busiest first and Unknown last', () => {
    const slices = platformSlices([
      p('Windows', 10),
      p(UNKNOWN_PLATFORM, 40),
      p('iOS', 30),
      p('Android', 20),
    ])
    expect(slices.map((s) => s.key)).toEqual(['iOS', 'Android', 'Windows', UNKNOWN_PLATFORM])
    expect(slices.map((s) => s.percent)).toEqual([30, 20, 10, 40])
  })

  it('keeps a platform on its own colour whatever its rank', () => {
    const slot = (rows: Array<{ platform: string; count: number }>, key: string) =>
      platformSlices(rows).find((s) => s.key === key)?.slot
    expect(slot([p('iOS', 9), p('Android', 1)], 'iOS')).toBe(slot([p('iOS', 1), p('Android', 9)], 'iOS'))
    const all = platformSlices(
      ['iOS', 'iPadOS', 'Android', 'macOS', 'Windows', 'Linux', 'ChromeOS'].map((o) => p(o, 1)),
    )
    expect(new Set(all.map((s) => s.slot)).size).toBe(all.length)
    expect(all.every((s) => s.slot >= 1 && s.slot <= 7)).toBe(true)
  })

  it('draws the unknown slice in the grey slot', () => {
    expect(platformSlices([p(UNKNOWN_PLATFORM, 3)])[0]).toMatchObject({ slot: 0, name: 'Unknown', percent: 100 })
  })

  it('gives an iPad a slice of its own, not the iOS one', () => {
    const slices = platformSlices([p('iOS', 3), p('iPadOS', 2)])
    expect(slices.map((s) => s.key)).toEqual(['iOS', 'iPadOS'])
    expect(slices[0].slot).not.toBe(slices[1].slot)
  })

  it('names a platform as its own word', () => {
    expect(platformName('macOS')).toBe('macOS')
    expect(platformName(UNKNOWN_PLATFORM)).toBe('Unknown')
  })
})
