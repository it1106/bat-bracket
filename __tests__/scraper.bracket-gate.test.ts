import fs from 'fs'
import path from 'path'
import { bracketHasSeededPlayers } from '@/lib/scraper'

const fixture = (name: string) =>
  fs.readFileSync(path.join(process.cwd(), 'fixtures', name), 'utf-8')

describe('bracketHasSeededPlayers', () => {
  it('returns true when at least one entrant has data-player-id', () => {
    expect(bracketHasSeededPlayers(fixture('draws-seeded.html'))).toBe(true)
  })

  it('returns false when there are no data-player-id entrants', () => {
    expect(bracketHasSeededPlayers(fixture('draws-empty.html'))).toBe(false)
  })

  it('returns false on empty / malformed HTML', () => {
    expect(bracketHasSeededPlayers('')).toBe(false)
    expect(bracketHasSeededPlayers('<html></html>')).toBe(false)
  })
})
