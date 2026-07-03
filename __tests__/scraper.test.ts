import fs from 'fs'
import path from 'path'
import { parseTournaments, parseEvents, parseBracket, parseBracketEntries, extractProfileUrl, parseMatchesPartial, orderScheduleGroups, extractMatchTeams, extractFlatPlayerIds, parsePlayerProfile } from '@/lib/scraper'
import * as cheerio from 'cheerio'
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

describe('parseBracketEntries', () => {
  // Real BAT BS U9 draw: 25 entries in a 32-slot bracket (7 byes). Used to
  // verify the BAT roster path that backs the stats events/players count.
  it('extracts every registered player from a BAT singles bracket', () => {
    const html = fixtureHtml('bracket-bat-bsu9.html')
    const entries = parseBracketEntries(html, '6', 'BS U9')
    // Collect unique playerIds across all entries. Should equal the 25
    // entries shown on BAT's events page for this draw.
    const playerIds = new Set<string>()
    for (const e of entries) {
      for (const p of [...e.team1, ...e.team2]) {
        if (p.playerId) playerIds.add(p.playerId)
      }
    }
    expect(playerIds.size).toBe(25)
    expect(entries[0].draw).toBe('BS U9')
    expect(entries[0].drawNum).toBe('6')
  })

  it('returns an empty array when no bracket markup is present', () => {
    expect(parseBracketEntries('<html><body></body></html>', '1', 'MS')).toEqual([])
  })
})

describe('extractMatchTeams', () => {
  it('returns two teams from a populated singles match element', () => {
    const html = `
      <div class="match">
        <div class="match__row">
          <div class="match__row-title-value"><a href="?player=11"><span class="nav-link__value">Alpha</span></a></div>
        </div>
        <div class="match__row">
          <div class="match__row-title-value"><a href="?player=22"><span class="nav-link__value">Beta</span></a></div>
        </div>
      </div>`
    const $ = cheerio.load(html)
    const teams = extractMatchTeams($, $('.match')[0])
    expect(teams).toEqual([
      [{ name: 'Alpha', playerId: '11' }],
      [{ name: 'Beta', playerId: '22' }],
    ])
  })

  it('drops teams whose players all have empty names (bye row)', () => {
    const html = `
      <div class="match">
        <div class="match__row">
          <div class="match__row-title-value"><a href="?player=11"><span class="nav-link__value">Alpha</span></a></div>
        </div>
        <div class="match__row">
          <div class="match__row-title-value"><a></a></div>
        </div>
      </div>`
    const $ = cheerio.load(html)
    const teams = extractMatchTeams($, $('.match')[0])
    expect(teams).toEqual([[{ name: 'Alpha', playerId: '11' }]])
  })

  it('returns two players per team for doubles', () => {
    const html = `
      <div class="match">
        <div class="match__row">
          <div class="match__row-title-value"><a href="?player=11"><span class="nav-link__value">A1</span></a></div>
          <div class="match__row-title-value"><a href="?player=12"><span class="nav-link__value">A2</span></a></div>
        </div>
        <div class="match__row">
          <div class="match__row-title-value"><a href="?player=21"><span class="nav-link__value">B1</span></a></div>
          <div class="match__row-title-value"><a href="?player=22"><span class="nav-link__value">B2</span></a></div>
        </div>
      </div>`
    const $ = cheerio.load(html)
    const teams = extractMatchTeams($, $('.match')[0])
    expect(teams).toEqual([
      [{ name: 'A1', playerId: '11' }, { name: 'A2', playerId: '12' }],
      [{ name: 'B1', playerId: '21' }, { name: 'B2', playerId: '22' }],
    ])
  })
})

describe('parsePlayerProfile — profile player id', () => {
  // Profile page where the requested player (501) appears on team2 of their
  // first match, so the FIRST a[data-player-id] in the DOM belongs to the
  // opponent (412). The win/loss dot in the modal keys off profile.playerId,
  // so a mis-derived id put the dot on the opponent instead of the player.
  const html = `
    <div class="match-group">
      <div class="match-group__item">
        <div class="match">
          <div class="match__header-title">
            <div class="match__header-title-item"><span class="nav-link__value">R32</span></div>
            <div class="match__header-title-item"><a href="?draw=5"><span class="nav-link__value">XD U15</span></a></div>
          </div>
          <div class="match__row has-won">
            <div class="match__row-title-value"><a href="?player=412" data-player-id="412"><span class="nav-link__value">Opponent</span></a></div>
          </div>
          <div class="match__row">
            <div class="match__row-title-value"><a href="?player=501" data-player-id="501"><span class="nav-link__value">Mathias</span></a></div>
          </div>
        </div>
      </div>
    </div>`

  it('uses the known (requested) player id, not the first link in the DOM', () => {
    const profile = parsePlayerProfile(html, {}, '501')
    expect(profile.playerId).toBe('501')
    // The match itself still parses correctly: opponent won (team1 has-won).
    expect(profile.matches[0].winner).toBe(1)
    expect(profile.matches[0].team1[0].playerId).toBe('412')
    expect(profile.matches[0].team2[0].playerId).toBe('501')
  })

  it('looks up the club by the known player id', () => {
    const profile = parsePlayerProfile(html, { '501': 'Team DEN' }, '501')
    expect(profile.club).toBe('Team DEN')
  })
})

describe('extractFlatPlayerIds', () => {
  it('returns all player IDs across both rows', () => {
    const html = `
      <div class="match">
        <div class="match__row">
          <div class="match__row-title-value"><a href="?player=11"><span class="nav-link__value">Alpha</span></a></div>
        </div>
        <div class="match__row">
          <div class="match__row-title-value"><a href="?player=22"><span class="nav-link__value">Beta</span></a></div>
        </div>
      </div>`
    const $ = cheerio.load(html)
    expect(extractFlatPlayerIds($, $('.match')[0])).toEqual(['11', '22'])
  })

  it('skips links without a player= query parameter', () => {
    const html = `
      <div class="match">
        <div class="match__row">
          <div class="match__row-title-value"><a href="/no-id">No</a></div>
        </div>
      </div>`
    const $ = cheerio.load(html)
    expect(extractFlatPlayerIds($, $('.match')[0])).toEqual([])
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
    expect(groups[0].matches[0].duration).toBe('23m')
    expect(groups[0].matches[0].nowPlaying).toBe(false) // no icon-sport2 in fixture
  })

  it('reads the location block on non-live matches', () => {
    const html = wrap(`
      <span class="match__header-aside-block" title="Duration: 16m | Main Location - 1"></span>
    `)
    const { groups } = parseMatchesPartial(html)
    expect(groups[0].matches[0].court).toBe('Main Location - 1')
    expect(groups[0].matches[0].duration).toBe('16m')
  })

  it('handles tooltips without a duration segment', () => {
    const html = wrap(`
      <span class="match__header-aside-block" title="Main Location - 2"></span>
    `)
    const { groups } = parseMatchesPartial(html)
    expect(groups[0].matches[0].court).toBe('Main Location - 2')
    expect(groups[0].matches[0].duration).toBeUndefined()
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
