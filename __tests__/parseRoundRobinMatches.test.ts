import fs from 'fs'
import path from 'path'
import { parseRoundRobinMatches } from '@/lib/scraper'

const fixtureHtml = (name: string) =>
  fs.readFileSync(path.join(process.cwd(), 'fixtures', name), 'utf-8')

describe('parseRoundRobinMatches', () => {
  it('parses round-robin matches from BS U11 Group A fixture', () => {
    const matches = parseRoundRobinMatches(
      fixtureHtml('group-draw-bs-u11-a.html'),
      'BS U11 - Group A',
    )
    expect(matches.length).toBeGreaterThan(0)
    expect(matches.every((m) => m.draw === 'BS U11 - Group A')).toBe(true)
    expect(matches[0].round).toMatch(/^Round \d+$/i)
    // Pre-tournament fixture: no winners decided, no scores
    expect(matches.every((m) => m.winner === null)).toBe(true)
  })

  it('skips invisible match placeholders (byes / odd-size)', () => {
    const matches = parseRoundRobinMatches(
      fixtureHtml('group-draw-bs-u11-a.html'),
      'BS U11 - Group A',
    )
    matches.forEach((m) => {
      const teams = [m.team1, m.team2]
      const hasAnyName = teams.some((t) => t.some((p) => p.name.length > 0))
      expect(hasAnyName).toBe(true)
    })
  })

  it('returns empty array for unrelated HTML', () => {
    expect(parseRoundRobinMatches('<html><body></body></html>', 'X')).toEqual([])
  })
})
