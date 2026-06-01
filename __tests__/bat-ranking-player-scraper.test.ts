import * as fs from 'fs'
import * as path from 'path'
import { parseRankingPlayerPage } from '@/lib/bat-ranking-player-scraper'

const FIX = path.join(__dirname, 'fixtures', 'bat-ranking-player.html')
const FIXTURE_HTML = fs.readFileSync(FIX, 'utf8')

describe('parseRankingPlayerPage (real BAT fixture)', () => {
  it('produces at least 5 tournament rows', () => {
    const { tournaments } = parseRankingPlayerPage(FIXTURE_HTML)
    expect(tournaments.length).toBeGreaterThanOrEqual(5)
  })

  it('every row has a non-empty tournamentName, sourceEvent, week, result, and finite points', () => {
    const { tournaments } = parseRankingPlayerPage(FIXTURE_HTML)
    for (const t of tournaments) {
      expect(t.tournamentName).not.toBe('')
      expect(t.sourceEvent).toMatch(/[A-Z]{2,3}\s*U?\d*/)
      expect(t.week).toMatch(/^\d{4}-\d{1,2}$/)
      expect(t.result).not.toBe('')
      expect(Number.isFinite(t.points)).toBe(true)
      expect(t.points).toBeGreaterThanOrEqual(0)
    }
  })

  it('at least one row counts toward a ranking (has the marker img with title)', () => {
    const { tournaments } = parseRankingPlayerPage(FIXTURE_HTML)
    const marked = tournaments.filter((t) => t.countsTowardRankings.length > 0)
    expect(marked.length).toBeGreaterThanOrEqual(1)
  })

  it('marker titles list 1+ category names — parsed as separate strings', () => {
    const { tournaments } = parseRankingPlayerPage(FIXTURE_HTML)
    const marked = tournaments.find((t) => t.countsTowardRankings.length > 0)!
    for (const cat of marked.countsTowardRankings) {
      expect(cat).toMatch(/U?\d*\s*(Men|Women|Boys|Girls|Mixed)/i)
    }
  })

  it("returns null tournamentId when BAT's link uses a numeric internal id (no in-app GUID match)", () => {
    // BAT ranking pages use tournament.aspx?id=<rankingId>&tournament=<numeric>,
    // which doesn't carry the GUID we route on in this app — surface the row
    // but make it unlinkable. Synthetic GUID-present test below proves the
    // happy path on a different shape.
    const { tournaments } = parseRankingPlayerPage(FIXTURE_HTML)
    expect(tournaments.length).toBeGreaterThan(0)
    for (const t of tournaments) expect(t.tournamentId).toBeNull()
  })
})

describe('parseRankingPlayerPage (synthetic edge cases)', () => {
  it('returns empty list on a page with no tournament rows', () => {
    const { tournaments } = parseRankingPlayerPage('<html><body><h1>No data</h1></body></html>')
    expect(tournaments).toEqual([])
  })

  it('handles a row missing the marker img — countsTowardRankings is []', () => {
    const html = `
      <table>
        <tbody>
        <tr>
          <td><a href="tournament.aspx?id=ABCDEF12-0000-0000-0000-000000000000">Open 2026</a></td>
          <td><a href="../sport/event.aspx?id=1">BS U15</a></td>
          <td>2026-20</td>
          <td>17/32</td>
          <td>3355</td>
          <td><a href="../sport/player.aspx?id=1&player=2">Matches</a></td>
        </tr>
        </tbody>
      </table>
    `
    const { tournaments } = parseRankingPlayerPage(html)
    expect(tournaments).toHaveLength(1)
    expect(tournaments[0].countsTowardRankings).toEqual([])
    expect(tournaments[0].tournamentId).toBe('ABCDEF12-0000-0000-0000-000000000000')
  })

  it('parses a multi-ranking title attribute (splits on comma)', () => {
    const html = `
      <table>
        <tbody>
        <tr>
          <td><a href="tournament.aspx?id=ABCDEF12-0000-0000-0000-000000000000">Open 2026</a></td>
          <td><a href="../sport/event.aspx?id=1">BS U15</a></td>
          <td>2026-20</td>
          <td>17/32</td>
          <td>3355</td>
          <td><a href="../sport/player.aspx?id=1&player=2">Matches</a></td>
          <td><img src="//static.tournamentsoftware.com/images/icon_new.gif"
            title="Used for: U23 Men's singles, U19 Boys singles" /></td>
        </tr>
        </tbody>
      </table>
    `
    const { tournaments } = parseRankingPlayerPage(html)
    expect(tournaments[0].countsTowardRankings).toEqual([
      "U23 Men's singles",
      'U19 Boys singles',
    ])
  })

  it('handles a tournament link with no GUID parameter — tournamentId is null', () => {
    const html = `
      <table>
        <tbody>
        <tr>
          <td><a href="tournament.aspx?other=value">Mystery</a></td>
          <td><a href="../sport/event.aspx?id=1">BS U11</a></td>
          <td>2026-01</td>
          <td>1/4</td>
          <td>500</td>
          <td><a href="../sport/player.aspx?id=1&player=2">Matches</a></td>
        </tr>
        </tbody>
      </table>
    `
    const { tournaments } = parseRankingPlayerPage(html)
    expect(tournaments[0].tournamentId).toBeNull()
  })
})
