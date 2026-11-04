import fs from 'fs'
import path from 'path'
import { buildBracketHtml } from '@/lib/providers/bwf/bracket-html'

const fixture = (name: string) =>
  JSON.parse(fs.readFileSync(path.join(process.cwd(), 'fixtures', 'bwf', name), 'utf-8'))

describe('buildBracketHtml', () => {
  it('produces bk-wrap structure with rounds and match slots', () => {
    const html = buildBracketHtml(fixture('tournament-draw-data.json'), 'BS U13')
    expect(html).toContain('class="bk-wrap bk-wrap--roomy"')
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

  it('shows the court on an upcoming match only', () => {
    // M1 (0-0) is finished on "Court 1"; M2 (0-1) is upcoming on "Court 2".
    const html = buildBracketHtml(fixture('tournament-draw-data.json'), 'BS U13')
    expect(html).toContain('<span class="bk-court">Court 2</span>')
    expect(html).not.toContain('Court 1')
  })

  it('renders a court-only footer when the upcoming match has no time', () => {
    const html = buildBracketHtml({
      gameTypeId: 1,
      results: {
        '0-0': { match: { winner: 0, roundName: 'Final', courtName: 'Court 7' } },
      },
    }, 'BS U13')
    expect(html).toContain('class="bk-footer"')
    expect(html).toContain('<span class="bk-court">Court 7</span>')
    expect(html).not.toContain('class="bk-time"')
  })

  it('hides the court when the order of play says it is TBA', () => {
    const html = buildBracketHtml({
      gameTypeId: 1,
      results: {
        '0-0': { match: {
          winner: 0, roundName: 'Final', courtName: 'Court 13',
          matchTime: '2026-11-05 15:30:00', oopText: 'Court and time TBA',
        } },
      },
    }, 'BS U13')
    expect(html).toContain('class="bk-time"')
    expect(html).not.toContain('bk-court')
  })

  it('keeps the court on a "Followed by" order-of-play line', () => {
    const html = buildBracketHtml({
      gameTypeId: 1,
      results: {
        '0-0': { match: {
          winner: 0, roundName: 'Final', courtName: 'Court 13',
          matchTime: '2026-11-05 15:30:00', oopText: 'Followed by',
        } },
      },
    }, 'BS U13')
    expect(html).toContain('<span class="bk-court">Court 13</span>')
  })

  it('marks the wrapper roomy so the wider column CSS applies', () => {
    const html = buildBracketHtml(fixture('tournament-draw-data.json'), 'BS U13')
    expect(html).toContain('class="bk-wrap bk-wrap--roomy"')
  })

  it('marks the wrapper roomy on the empty-draw placeholder too', () => {
    const html = buildBracketHtml({ drawsize: 0, drawendcol: 0, results: {} }, 'X')
    expect(html).toContain('class="bk-wrap bk-wrap--roomy"')
  })

  it('leaves room under the last slot of a round', () => {
    const html = buildBracketHtml(fixture('tournament-draw-data.json'), 'BS U13')
    const roundH = Number(/<div class="bk-round" style="height:(\d+)px"/.exec(html)![1])
    const tops = (html.match(/bk-match-slot" style="position:absolute;top:\d+px/g) ?? [])
      .map((m) => Number(/top:(\d+)px/.exec(m)![1]))
    // A match box with a footer measures ~88px; the round must outlast it.
    expect(roundH).toBeGreaterThan(Math.max(...tops) + 88)
  })

  it('keeps the footer off an upcoming match with neither time nor court', () => {
    const html = buildBracketHtml({
      gameTypeId: 1,
      results: {
        '0-0': { match: { winner: 0, roundName: 'Final' } },
      },
    }, 'BS U13')
    expect(html).not.toContain('class="bk-footer"')
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
