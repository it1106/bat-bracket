import fs from 'fs'
import path from 'path'
import { buildBracketHtml } from '@/lib/providers/bwf/bracket-html'

const fixture = (name: string) =>
  JSON.parse(fs.readFileSync(path.join(process.cwd(), 'fixtures', 'bwf', name), 'utf-8'))

describe('buildBracketHtml', () => {
  it('produces a stable HTML string for a known draw', () => {
    const html = buildBracketHtml(fixture('tournament-draw-data.json'), 'BS U13')
    expect(html).toMatchSnapshot()
  })

  it('returns "no data" placeholder when results are empty', () => {
    const html = buildBracketHtml({ drawsize: 0, drawendcol: 0, results: {} }, 'X')
    expect(html).toContain('No data')
  })

  it('marks the winner team with team-win class', () => {
    const html = buildBracketHtml(fixture('tournament-draw-data.json'), 'BS U13')
    // Match M1 has winner=1, so team1 should be team-win
    expect(html).toMatch(/team1[^"]*team-win/)
  })
})
