import fs from 'fs'
import path from 'path'
import { parseTournaments, parseEvents, parseBracket, extractProfileUrl } from '@/lib/scraper'

const fixtureHtml = (name: string) =>
  fs.readFileSync(path.join(process.cwd(), 'fixtures', name), 'utf-8')

describe('parseTournaments', () => {
  it('extracts tournament list from HTML', () => {
    const html = fixtureHtml('tournaments.html')
    const tournaments = parseTournaments(html)
    expect(tournaments).toHaveLength(2)
    expect(tournaments[0]).toEqual({
      id: 'abc123',
      name: 'BAT Thailand Junior Circuit 1/2569',
      date: '17 Apr 2026',
      url: '/tournament/abc123/schedule',
    })
  })

  it('returns empty array when no tournaments found', () => {
    const tournaments = parseTournaments('<html><body></body></html>')
    expect(tournaments).toEqual([])
  })
})

describe('parseEvents', () => {
  it('extracts draw events from HTML', () => {
    const html = fixtureHtml('events.html')
    const events = parseEvents(html)
    expect(events).toHaveLength(3)
    expect(events[0]).toEqual({
      id: '1',
      name: "Boys' Singles U17",
      drawUrl: '/tournament/abc123/draw/1',
    })
  })

  it('returns empty array when no draws found', () => {
    const events = parseEvents('<html><body></body></html>')
    expect(events).toEqual([])
  })
})

describe('parseBracket', () => {
  it('extracts bk-wrap HTML from bracket page', () => {
    const html = fixtureHtml('bracket.html')
    const result = parseBracket(html)
    expect(result.html).toContain('class="bk-wrap"')
    expect(result.html).toContain('bk-round')
  })

  it('detects single elimination format', () => {
    const html = fixtureHtml('bracket.html')
    const result = parseBracket(html)
    expect(result.format).toBe('single-elimination')
  })

  it('returns empty html when bk-wrap not found', () => {
    const result = parseBracket('<html><body>not a bracket</body></html>')
    expect(result.html).toBe('')
    expect(result.format).toBe('unknown')
  })
})

describe('extractProfileUrl', () => {
  it('matches the legacy /player-profile/{guid} format', () => {
    const html = '<a class="media__link" href="/player-profile/abc-123">Name</a>'
    expect(extractProfileUrl(html)).toBe('/player-profile/abc-123')
  })

  it('matches the new /player/{orgCode}/{memberID} format', () => {
    const html =
      '<a class="nav-link media__link text--link-white text--link" ' +
      'href="/player/b06eafc7-fdae-450f-909e-317c6770352d/YmFzZTY0OjgxODk2NDA5">Name</a>'
    expect(extractProfileUrl(html)).toBe(
      '/player/b06eafc7-fdae-450f-909e-317c6770352d/YmFzZTY0OjgxODk2NDA5'
    )
  })

  it('prefers the legacy format when both are present', () => {
    const html =
      '<a class="media__link" href="/player/org/mid">New</a>' +
      '<a class="media__link" href="/player-profile/legacy">Legacy</a>'
    expect(extractProfileUrl(html)).toBe('/player-profile/legacy')
  })

  it('ignores same-tournament /sport/player.aspx links', () => {
    const html =
      '<a href="/sport/player.aspx?id=X&player=2835">Opponent</a>' +
      '<a href="/find/player">Find players</a>'
    expect(extractProfileUrl(html)).toBe('')
  })

  it('returns empty string when no profile link is present', () => {
    expect(extractProfileUrl('<html><body></body></html>')).toBe('')
  })
})
