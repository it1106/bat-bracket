import fs from 'fs'
import path from 'path'
import { buildBracketHtml } from '@/lib/providers/bwf/bracket-html'

const fixture = (name: string) =>
  JSON.parse(fs.readFileSync(path.join(process.cwd(), 'fixtures', 'bwf', name), 'utf-8'))

describe('buildBracketHtml', () => {
  it('produces bk-wrap structure with rounds and match slots', () => {
    const html = buildBracketHtml(fixture('tournament-draw-data.json'), 'BS U13')
    expect(html).toContain('class="bk-wrap"')
    expect(html).toContain('class="bk-round"')
    expect(html).toContain('class="bk-match-slot"')
    expect(html).toContain('data-round-index="0"')
    expect(html).toContain('data-round-index="1"')
  })

  it('returns "no data" placeholder when results are empty', () => {
    const html = buildBracketHtml({ drawsize: 0, drawendcol: 0, results: {} }, 'X')
    expect(html).toContain('No data')
  })

  it('marks the winner row with winner class', () => {
    const html = buildBracketHtml(fixture('tournament-draw-data.json'), 'BS U13')
    // Match M1 has winner=1, so first team row should have winner class
    expect(html).toContain('class="bk-row winner"')
  })

  it('renders seed number', () => {
    const html = buildBracketHtml(fixture('tournament-draw-data.json'), 'BS U13')
    expect(html).toContain('<span class="bk-seed">1</span>')
  })

  it('renders country flag', () => {
    const html = buildBracketHtml(fixture('tournament-draw-data.json'), 'BS U13')
    expect(html).toContain('class="bk-flag"')
    expect(html).toContain('https://example/tha.svg')
  })

  it('stamps each player span with a lowercase data-country for search', () => {
    const html = buildBracketHtml(fixture('tournament-draw-data.json'), 'BS U13')
    expect(html).toContain('data-country="tha"')
  })

  it('formats the footer time as DD/MM/YY HH:MM', () => {
    // M2 in the fixture is unplayed (winner=0) with matchTime 2026-05-19T11:00:00Z
    const html = buildBracketHtml(fixture('tournament-draw-data.json'), 'BS U13')
    expect(html).toContain('<span class="bk-time">19/05/26 11:00</span>')
    expect(html).not.toContain('2026-05-19T11:00:00Z')
  })

  it('respects fromRound by slicing columns', () => {
    const fullHtml = buildBracketHtml(fixture('tournament-draw-data.json'), 'BS U13', 0)
    const fromHtml = buildBracketHtml(fixture('tournament-draw-data.json'), 'BS U13', 1)
    // fromRound=1 should show fewer rounds
    const fullRounds = (fullHtml.match(/data-round-index=/g) ?? []).length
    const fromRounds = (fromHtml.match(/data-round-index=/g) ?? []).length
    expect(fromRounds).toBeLessThan(fullRounds)
    // The first displayed round still carries its absolute index
    expect(fromHtml).toContain('data-round-index="1"')
    expect(fromHtml).not.toContain('data-round-index="0"')
  })
})
