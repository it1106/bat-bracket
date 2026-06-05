import fs from 'fs'
import path from 'path'
import { parseRankingPlayerPage } from '@/lib/ranking/player-scraper'

const bwfHtml = fs.readFileSync(
  path.join(__dirname, '..', 'fixtures', 'ranking-player-bwf.html'),
  'utf8',
)

describe('parseRankingPlayerPage', () => {
  it('parses tournaments from BWF per-player page', () => {
    const { tournaments } = parseRankingPlayerPage(bwfHtml)
    expect(tournaments.length).toBeGreaterThan(0)
    const first = tournaments[0]
    expect(first.tournamentName.length).toBeGreaterThan(0)
    expect(first.week).toMatch(/^\d{4}-\d{1,2}$/)
    expect(first.points).toBeGreaterThanOrEqual(0)
  })

  it('captures "Used for" marker categories', () => {
    const { tournaments } = parseRankingPlayerPage(bwfHtml)
    const marked = tournaments.find(t => t.countsTowardRankings.length > 0)
    expect(marked).toBeDefined()
  })
})
