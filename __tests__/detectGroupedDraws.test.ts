import { detectGroupedDraws } from '@/lib/scraper'
import type { DrawInfo } from '@/lib/types'

const draw = (drawNum: string, name: string, type: string): DrawInfo => ({
  drawNum, name, size: '', type,
})

describe('detectGroupedDraws', () => {
  it('annotates group draws with eventName + groupLetter', () => {
    const input = [
      draw('1', 'BS U11 - Group A', 'Round Robin'),
      draw('2', 'BS U11 - Group B', 'Round Robin'),
      draw('9', 'BS U11', 'Elimination'),
    ]
    const out = detectGroupedDraws(input)
    expect(out[0]).toMatchObject({ eventName: 'BS U11', groupLetter: 'A' })
    expect(out[1]).toMatchObject({ eventName: 'BS U11', groupLetter: 'B' })
    expect(out[2]).toMatchObject({ eventName: 'BS U11', isPlayoff: true })
  })

  it('leaves non-grouped tournaments unchanged', () => {
    const input = [
      draw('1', "Men's Singles", 'Elimination'),
      draw('2', "Women's Doubles", 'Elimination'),
    ]
    const out = detectGroupedDraws(input)
    expect(out[0].eventName).toBeUndefined()
    expect(out[0].isPlayoff).toBeUndefined()
    expect(out[1].eventName).toBeUndefined()
  })

  it('does not mark playoff if no group siblings exist (orphan elimination)', () => {
    const input = [draw('9', 'BS U11', 'Elimination')]
    const out = detectGroupedDraws(input)
    expect(out[0].eventName).toBeUndefined()
    expect(out[0].isPlayoff).toBeUndefined()
  })

  it('handles mixed tournament with some grouped, some not', () => {
    const input = [
      draw('1', 'BS U11 - Group A', 'Round Robin'),
      draw('9', 'BS U11', 'Elimination'),
      draw('20', "Men's Singles", 'Elimination'),
    ]
    const out = detectGroupedDraws(input)
    expect(out[0].groupLetter).toBe('A')
    expect(out[1].isPlayoff).toBe(true)
    expect(out[2].eventName).toBeUndefined()
  })

  it('does not mutate input array', () => {
    const input = [draw('1', 'BS U11 - Group A', 'Round Robin'), draw('9', 'BS U11', 'Elimination')]
    const snapshot = JSON.parse(JSON.stringify(input))
    detectGroupedDraws(input)
    expect(input).toEqual(snapshot)
  })
})
