import fs from 'fs'
import path from 'path'
import { parseStandings } from '@/lib/scraper'

const fixtureHtml = (name: string) =>
  fs.readFileSync(path.join(process.cwd(), 'fixtures', name), 'utf-8')

describe('parseStandings', () => {
  it('parses BS U11 Group A entrants from real fixture', () => {
    const rows = parseStandings(fixtureHtml('group-standings-bs-u11-a.html'))
    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0].position).toBe(1)
    expect(rows[0].players.length).toBeGreaterThan(0)
    expect(rows[0].players[0].playerId).toMatch(/^\d+$/)
    expect(rows[0].players[0].name.length).toBeGreaterThan(0)
    expect(rows[0].played).toBe(0)  // pre-tournament fixture
    expect(rows[0].won).toBe(0)
    expect(rows[0].lost).toBe(0)
    expect(rows[0].pts).toBe(0)
    expect(typeof rows[0].matches).toBe('string')
    expect(typeof rows[0].games).toBe('string')
  })

  it('returns rows in non-decreasing position order (ties allowed pre-tournament)', () => {
    const rows = parseStandings(fixtureHtml('group-standings-bs-u11-a.html'))
    expect(rows.length).toBeGreaterThanOrEqual(2)
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].position).toBeGreaterThanOrEqual(rows[i - 1].position)
    }
  })

  it('returns empty array for non-standings HTML', () => {
    expect(parseStandings('<html><body>nothing</body></html>')).toEqual([])
  })
})
