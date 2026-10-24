import fs from 'fs'
import path from 'path'
import {
  parseLegacyDrawsheet,
  legacyBracketData,
  parseLegacyMatchesFull,
  isLegacyOnlyResponse,
  isLegacySheet,
} from '@/lib/legacy-scraper'

const fixtureHtml = (name: string) =>
  fs.readFileSync(path.join(process.cwd(), 'fixtures', name), 'utf-8')

// Both fixtures are from Teamกีฬาสาธิตสามัคคี ครั้งที่49 (4BD68829…), the one
// BAT event that exists only on the legacy /sport/*.aspx pages.
const DRAW_8 = 'legacy-drawsheet-team-8.html'   // 8 teams, ประถม ทีมชาย
const DRAW_16 = 'legacy-drawsheet-team-16.html' // 16 teams, มัธยมต้น ทีมชาย

describe('isLegacyOnlyResponse', () => {
  it('spots the legacy page the modern routes end up on', () => {
    // The real chain: /tournament/{guid}/matches → /unknown/{guid} →
    // /sport/tournament.aspx?id={guid}, all followed, final status 200.
    expect(isLegacyOnlyResponse('https://bat.tournamentsoftware.com/sport/tournament.aspx?id=4bd68829-652d-41d3-b87b-f8ae94af3f55')).toBe(true)
    expect(isLegacyOnlyResponse('https://bat.tournamentsoftware.com/unknown/4bd68829-652d-41d3-b87b-f8ae94af3f55')).toBe(true)
  })

  it('leaves a modern route that stayed put alone', () => {
    expect(isLegacyOnlyResponse('https://bat.tournamentsoftware.com/tournament/21718a74/matches')).toBe(false)
    expect(isLegacyOnlyResponse('https://bat.tournamentsoftware.com/tournament/21718a74/Draw/3/GetDrawContent?tabindex=1')).toBe(false)
  })

  it('says no when there is no usable URL to judge', () => {
    expect(isLegacyOnlyResponse('')).toBe(false)
  })

  // The finding is remembered for the life of the worker, so a redirect that
  // means something else entirely must not be read as "legacy-only".
  it('does not mistake a cookiewall or login redirect for a legacy event', () => {
    expect(isLegacyOnlyResponse('https://bat.tournamentsoftware.com/cookiewall?ReturnUrl=%2Ftournament%2Fabc%2Fmatches')).toBe(false)
    expect(isLegacyOnlyResponse('https://bat.tournamentsoftware.com/member/login.aspx?returnurl=x')).toBe(false)
  })

  // Next.js patches global fetch and returns a rebuilt Response whose url is
  // empty, so the body has to carry the signal on its own.
  it('recognises the legacy landing page with no URL to go by', () => {
    expect(isLegacyOnlyResponse('', fixtureHtml('legacy-landing.html'))).toBe(true)
  })

  it('does not take a modern page for a legacy one', () => {
    const modern = '<html><a href="/sport/x">x</a><div class="js-date-selection-tab"></div>'
      + '<div class="match-group__wrapper"></div></html>'
    expect(isLegacyOnlyResponse('', modern)).toBe(false)
    expect(isLegacyOnlyResponse('', '<html><body>something else entirely</body></html>')).toBe(false)
  })
})

describe('isLegacySheet', () => {
  it('tells a cached drawsheet apart from modern bracket markup', () => {
    expect(isLegacySheet(fixtureHtml(DRAW_8))).toBe(true)
    expect(isLegacySheet('<div class="bracket js-bracket"><swiper-container></swiper-container></div>')).toBe(false)
    expect(isLegacySheet('')).toBe(false)
  })
})

describe('parseLegacyDrawsheet', () => {
  it('returns [] for a page with no drawsheet table', () => {
    expect(parseLegacyDrawsheet('<html><body>nope</body></html>')).toEqual([])
  })

  it('reads an 8-team draw as 4 + 2 + 1 matches, named by the column headers', () => {
    const matches = parseLegacyDrawsheet(fixtureHtml(DRAW_8))
    const byRound = [0, 1, 2].map((r) => matches.filter((m) => m.round === r))
    expect(byRound.map((ms) => ms.length)).toEqual([4, 2, 1])
    expect(byRound.map((ms) => ms[0].roundName)).toEqual(['Quarter Finals', 'Semi Finals', 'Finals'])
  })

  it('reads a 16-team draw as 8 + 4 + 2 + 1 matches', () => {
    const matches = parseLegacyDrawsheet(fixtureHtml(DRAW_16))
    expect([0, 1, 2, 3].map((r) => matches.filter((m) => m.round === r).length)).toEqual([8, 4, 2, 1])
    expect(matches.find((m) => m.round === 0)!.roundName).toBe('Round 1')
  })

  it('keeps the entrants in slot order, with seeds split off the name', () => {
    const r1 = parseLegacyDrawsheet(fixtureHtml(DRAW_8)).filter((m) => m.round === 0)
    expect(r1[0].sides[0]).toEqual({ name: 'สาธิตประสานมิตร ประถม- ทีมชาย', seed: '1' })
    expect(r1[0].sides[1]).toBeNull() // slot 2 is a Bye
    expect(r1[1].sides.map((s) => s?.name)).toEqual(['สาธิตเชียงใหม่ ประถม- ทีมชาย', 'สาธิตราม ประถม- ทีมชาย'])
    expect(r1[3].sides[1]).toEqual({ name: 'สาธิตจุฬา ประถม- ทีมชาย', seed: '2' })
  })

  it('orients the score to side 1 even though the sheet prints it winner-first', () => {
    // The sheet shows "3-0" for สาธิตเชียงใหม่ vs สาธิตราม, where สาธิตราม won;
    // matches.aspx prints the same tie home-first as 0-3.
    const m = parseLegacyDrawsheet(fixtureHtml(DRAW_8)).filter((r) => r.round === 0)[1]
    expect(m.winner).toBe(2)
    expect(m.scores).toEqual([{ t1: 0, t2: 3 }])
  })

  it('marks a walkover and still names the side that went through', () => {
    const m = parseLegacyDrawsheet(fixtureHtml(DRAW_8)).filter((r) => r.round === 0)[2]
    expect(m.walkover).toBe(true)
    expect(m.winner).toBe(1)
    expect(m.scores).toEqual([])
  })

  it('carries court and kick-off time for a tie that has not been played', () => {
    const sf = parseLegacyDrawsheet(fixtureHtml(DRAW_8)).filter((r) => r.round === 1)[0]
    expect(sf.winner).toBeNull()
    expect(sf.court).toBe('Main Location - 3')
    expect(sf.scheduled).toBe('อา. 25/10/2569 13:00')
  })

  it('leaves a tie whose feeders are unplayed with no sides at all', () => {
    // Both finalists are still to be decided, and the sheet fills those slots
    // with the semi-finals' courts — not team names.
    const final = parseLegacyDrawsheet(fixtureHtml(DRAW_8)).filter((r) => r.round === 2)[0]
    expect(final.sides).toEqual([null, null])
    expect(final.court).toBe('Main Location - 3')
    expect(final.scheduled).toBe('จ. 26/10/2569 10:00')
  })

  it('leaves a bye through to the next round rather than inventing a result', () => {
    const bye = parseLegacyDrawsheet(fixtureHtml(DRAW_8)).filter((r) => r.round === 0)[0]
    expect(bye.winner).toBeNull()
    expect(bye.scores).toEqual([])
    expect(bye.walkover).toBe(false)
  })
})

describe('legacyBracketData', () => {
  it('renders bk-wrap HTML with every entrant counted', () => {
    const data = legacyBracketData(fixtureHtml(DRAW_8), 'ประถม ทีมชาย')
    expect(data.format).toBe('single-elimination')
    expect(data.html).toContain('bk-wrap')
    expect(data.html).toContain('สาธิตประสานมิตร ประถม- ทีมชาย')
    // 8 slots minus the one Bye
    expect(data.entrantCount).toBe(7)
  })

  it('labels the rounds the way the sheet does', () => {
    const data = legacyBracketData(fixtureHtml(DRAW_8), 'ประถม ทีมชาย')
    for (const name of ['Quarter Finals', 'Semi Finals', 'Finals']) {
      expect(data.html).toContain(name)
    }
  })

  it('drops earlier rounds when asked for a later one', () => {
    const full = legacyBracketData(fixtureHtml(DRAW_16), 'มัธยมต้น ทีมชาย')
    const fromQf = legacyBracketData(fixtureHtml(DRAW_16), 'มัธยมต้น ทีมชาย', 1)
    expect(full.html).toContain('Round 1')
    expect(fromQf.html).not.toContain('Round 1')
    expect(fromQf.html).toContain('Quarter Finals')
  })

  it('reports an empty bracket for a page without a drawsheet', () => {
    const data = legacyBracketData('<html><body>nope</body></html>', 'x')
    expect(data).toEqual({ html: '', format: 'unknown', entrantCount: 0 })
  })
})

describe('parseLegacyMatchesFull', () => {
  const day1 = () => parseLegacyMatchesFull(fixtureHtml('legacy-matches-day1.html'))

  it('lists the tournament days with ISO dates off the calendar links', () => {
    const { days, currentDate } = day1()
    expect(days.map((d) => d.dateIso)).toEqual(['2026-10-24', '2026-10-25', '2026-10-26'])
    expect(days.map((d) => d.date)).toEqual(['20261024', '20261025', '20261026'])
    expect(days[0].label).toBe('24/10')
    expect(currentDate).toBe('20261024')
  })

  it('groups the day by kick-off time', () => {
    const groups = day1().groups
    expect(groups.every((g) => g.type === 'time')).toBe(true)
    expect(groups.map((g) => (g.type === 'time' ? g.time : ''))).toEqual(['10:00', '13:00', '16:00'])
    expect(groups.reduce((n, g) => n + g.matches.length, 0)).toBe(24)
  })

  it('reads a tie as one entry, with the bold side as the winner', () => {
    const first = day1().groups[0].matches[0]
    expect(first.draw).toContain('มัธยมต้น ทีมชาย')
    expect(first.drawNum).toBe('14')
    expect(first.team1.map((p) => p.name)).toEqual(['สาธิตจุฬา มัธยม- ทีมชาย'])
    expect(first.team2.map((p) => p.name)).toEqual(['สาธิตมศว.องครักษ์ มัธยม -ทีมชาย'])
    expect(first.winner).toBe(1)
    expect(first.scores).toEqual([{ t1: 5, t2: 0 }])
    expect(first.court).toBe('Main Location - 2')
    expect(first.scheduledTime).toBe('10:00')
  })

  it('reads a tie the away side won without flipping the score', () => {
    const m = day1().groups[1].matches
      .find((e) => e.team1[0]?.name === 'สาธิตเชียงใหม่ ประถม- ทีมชาย')!
    expect(m.winner).toBe(2)
    expect(m.scores).toEqual([{ t1: 0, t2: 3 }])
  })

  it('flags a walkover and leaves it without a scoreline', () => {
    const m = day1().groups[1].matches.find((e) => e.walkover)!
    expect(m.team1[0].name).toBe('สาธิตมหาสารคาม ประถม- ทีมชาย')
    expect(m.winner).toBe(1)
    expect(m.scores).toEqual([])
  })

  it('reads a day whose ties have no result yet', () => {
    const { groups, currentDate } = parseLegacyMatchesFull(fixtureHtml('legacy-matches-day3.html'))
    expect(currentDate).toBe('20261026')
    const all = groups.flatMap((g) => g.matches)
    expect(all.length).toBeGreaterThan(0)
    expect(all.every((m) => m.winner === null && m.scores.length === 0)).toBe(true)
  })

  it('returns nothing rather than throwing on an unrelated page', () => {
    expect(parseLegacyMatchesFull('<html><body>nope</body></html>')).toEqual({
      days: [], currentDate: '', groups: [],
    })
  })
})
