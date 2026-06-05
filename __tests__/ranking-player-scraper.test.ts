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

describe('parseRankingPlayerPage — structured credits', () => {
  // Inline mini-HTML so the test does not depend on a captured fixture.
  // Matches BWF's row layout: 7 <td> cells, last one carrying the marker img.
  const rowWithCrossTier = `<table><tr>
    <td><a href="tournament.aspx?id=52035&tournament=305912">MITH YONEX</a></td>
    <td><a href="../sport/event.aspx?id=X&event=2">MS-U15</a></td>
    <td>2026-22</td>
    <td align="right"></td>
    <td align="right">960</td>
    <td><a href="../sport/player.aspx?id=X&player=121">Matches</a></td>
    <td><img src="x.gif" alt="" title="Used for: Boy's singles U17(288), Boy's singles U15" /></td>
  </tr></table>`

  const rowWithSingleDiscount = `<table><tr>
    <td><a href="tournament.aspx?id=52035&tournament=286957">YONEX CP</a></td>
    <td><a href="../sport/event.aspx?id=Y&event=6">MS U13</a></td>
    <td>2025-45</td>
    <td align="right"></td>
    <td align="right">2125</td>
    <td><a href="../sport/player.aspx?id=Y&player=163">Matches</a></td>
    <td><img src="x.gif" alt="" title="Used for: Boy's singles U15(637.5)" /></td>
  </tr></table>`

  it('parses both a discounted and a full-credit target on one row', () => {
    const { tournaments } = parseRankingPlayerPage(rowWithCrossTier)
    expect(tournaments).toHaveLength(1)
    const t = tournaments[0]
    expect(t.points).toBe(960)
    expect(t.countsTowardRankings).toEqual([
      "Boy's singles U17(288)",
      "Boy's singles U15",
    ])
    expect(t.countsTowardRankingsParsed).toEqual([
      { eventName: "Boy's singles U17", credit: 288 },
      { eventName: "Boy's singles U15", credit: 960 },
    ])
  })

  it('preserves decimal credit', () => {
    const { tournaments } = parseRankingPlayerPage(rowWithSingleDiscount)
    expect(tournaments[0].countsTowardRankingsParsed).toEqual([
      { eventName: "Boy's singles U15", credit: 637.5 },
    ])
  })

  it('row with no marker gets empty parsed credits', () => {
    const noMarker = `<table><tr>
      <td><a href="tournament.aspx?id=A&tournament=1">X</a></td>
      <td><a href="event.aspx?id=A">MS-U15</a></td>
      <td>2026-22</td>
      <td></td>
      <td>500</td>
      <td><a>Matches</a></td>
    </tr></table>`
    const { tournaments } = parseRankingPlayerPage(noMarker)
    expect(tournaments[0].countsTowardRankings).toEqual([])
    expect(tournaments[0].countsTowardRankingsParsed).toEqual([])
  })
})
