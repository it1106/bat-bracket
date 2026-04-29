import fs from 'fs'
import path from 'path'
import { parseTournaments, parseEvents, parseBracket, extractProfileUrl, parseMatchesPartial, orderScheduleGroups } from '@/lib/scraper'
import type { MatchScheduleGroup, MatchEntry } from '@/lib/types'

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

describe('parseMatchesPartial — court field', () => {
  // BAT renders a now-playing match with two .match__header-aside-block
  // siblings: the --primary "Now playing" badge first, then the actual
  // location block. Earlier the parser read .attr('title') from the first
  // match-block and ended up with "Now playing" instead of the court.
  const wrap = (asideBlocks: string) => `
    <div class="match-group__wrapper">
      <h5 class="match-group__header">10:00</h5>
      <ol class="match-group">
        <li class="match-group__item">
          <div class="match match--list">
            <div class="match__header-title">
              <div class="match__header-title-item">
                <a href="/draw=7"><span class="nav-link__value">XD U13</span></a>
              </div>
              <div class="match__header-title-item">
                <span class="nav-link__value">R32</span>
              </div>
            </div>
            ${asideBlocks}
            <div class="match__row"><span class="match__row-title-value"><a href="?player=1"><span class="nav-link__value">A</span></a></span></div>
            <div class="match__row"><span class="match__row-title-value"><a href="?player=2"><span class="nav-link__value">B</span></a></span></div>
          </div>
        </li>
      </ol>
    </div>`

  it('reads the location block (not the "Now playing" badge) on live matches', () => {
    const html = wrap(`
      <span class="match__header-aside-block match__header-aside-block--primary" title="Now playing"></span>
      <span class="match__header-aside-block" title="Duration: 23m | Main Location - 5"></span>
    `)
    const { groups } = parseMatchesPartial(html)
    expect(groups[0].matches[0].court).toBe('Main Location - 5')
    expect(groups[0].matches[0].nowPlaying).toBe(false) // no icon-sport2 in fixture
  })

  it('reads the location block on non-live matches', () => {
    const html = wrap(`
      <span class="match__header-aside-block" title="Duration: 16m | Main Location - 1"></span>
    `)
    const { groups } = parseMatchesPartial(html)
    expect(groups[0].matches[0].court).toBe('Main Location - 1')
  })
})

describe('orderScheduleGroups', () => {
  const stubMatch = (): MatchEntry => ({
    draw: '', drawNum: '', round: '', team1: [], team2: [], winner: null,
    scores: [], court: '', walkover: false, retired: false, nowPlaying: false,
  })
  const label = (g: MatchScheduleGroup) => g.type === 'time' ? g.time : g.court

  it('places all time-slot groups before any court-based group', () => {
    const groups: MatchScheduleGroup[] = [
      { type: 'court', court: 'Main Location - 2', matches: [stubMatch()] },
      { type: 'time', time: '14:00', matches: [stubMatch()] },
      { type: 'court', court: 'Main Location - 1', matches: [stubMatch()] },
      { type: 'time', time: '09:00', matches: [stubMatch()] },
    ]
    expect(orderScheduleGroups(groups).map(label)).toEqual([
      '14:00', '09:00', 'Main Location - 1', 'Main Location - 2',
    ])
  })

  it('preserves source order among time-slot groups', () => {
    const groups: MatchScheduleGroup[] = [
      { type: 'time', time: '14:00', matches: [stubMatch()] },
      { type: 'time', time: '09:00', matches: [stubMatch()] },
    ]
    expect(orderScheduleGroups(groups).map(label)).toEqual(['14:00', '09:00'])
  })

  it('sorts court groups numerically (1, 2, 10) not lexicographically', () => {
    const groups: MatchScheduleGroup[] = [
      { type: 'court', court: 'Main Location - 10', matches: [stubMatch()] },
      { type: 'court', court: 'Main Location - 2', matches: [stubMatch()] },
      { type: 'court', court: 'Main Location - 1', matches: [stubMatch()] },
    ]
    expect(orderScheduleGroups(groups).map(label)).toEqual([
      'Main Location - 1', 'Main Location - 2', 'Main Location - 10',
    ])
  })

  it('groups by venue then court number', () => {
    const groups: MatchScheduleGroup[] = [
      { type: 'court', court: 'Hall B - 1', matches: [stubMatch()] },
      { type: 'court', court: 'Hall A - 2', matches: [stubMatch()] },
      { type: 'court', court: 'Hall A - 1', matches: [stubMatch()] },
    ]
    expect(orderScheduleGroups(groups).map(label)).toEqual([
      'Hall A - 1', 'Hall A - 2', 'Hall B - 1',
    ])
  })

  it('places courts without a parseable number after numbered courts', () => {
    const groups: MatchScheduleGroup[] = [
      { type: 'court', court: 'Practice Court', matches: [stubMatch()] },
      { type: 'court', court: 'Practice Court - 1', matches: [stubMatch()] },
    ]
    expect(orderScheduleGroups(groups).map(label)).toEqual([
      'Practice Court - 1', 'Practice Court',
    ])
  })
})
