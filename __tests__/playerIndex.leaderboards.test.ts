import path from 'path'
import fs from 'fs'
import { buildIndex, buildLeaderboards } from '@/lib/playerIndex'
import type {
  Discipline, MatchesData, PlayerEventResult, PlayerIndexTournamentInput, PlayerRecord,
} from '@/lib/types'

function disc() { return { wins: 0, losses: 0, titles: 0, finals: 0, semis: 0 } }
function synthPlayer(slug: string, name: string, opts: {
  wins: number; losses: number; courtMinutes?: number; matchesWithDuration?: number;
  threeSetterWins?: number; threeSetterCount?: number;
}): PlayerRecord {
  const matches = opts.wins + opts.losses
  return {
    key: { provider: 'bat', slug }, displayName: name, altNames: [], clubs: [],
    totals: { matches, wins: opts.wins, losses: opts.losses,
      walkoversReceived: 0, walkoversGiven: 0, retirementsReceived: 0, retirementsGiven: 0 },
    byDiscipline: { singles: disc(), doubles: disc(), mixed: disc() },
    titles: [], finals: [], semis: [], tournaments: [], recentForm: [],
    matchCharacter: {
      courtMinutes: opts.courtMinutes ?? 0, avgMatchMinutes: 0,
      longestMatchMinutes: 0, longestMatchRef: null,
      threeSetterCount: opts.threeSetterCount ?? 0,
      threeSetterRate: 0,
      threeSetterWins: opts.threeSetterWins ?? 0,
      comebackWins: 0, firstGameLost: 0, comebackWinRef: null,
      matchesLast90: 0, matchesWithDuration: opts.matchesWithDuration,
    },
    opponents: [], partners: [], ranks: {},
  }
}

function loadInput(slug: string, name: string, date: string): PlayerIndexTournamentInput {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', `player-index-${slug}.json`), 'utf8')) as MatchesData
  const clubs = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', `player-index-${slug}-clubs.json`), 'utf8')) as Record<string, string>
  delete (clubs as Record<string, string>)._meta
  return { tournamentId: slug.toUpperCase(), tournamentName: name, tournamentDateIso: date, data, clubs }
}

describe('buildIndex — leaderboards', () => {
  const toyota = loadInput('toyota', 'Toyota', '2026-05-01')
  const trang = loadInput('trang', 'Trang', '2026-04-15')

  it('produces all 14 v1 boards', () => {
    const { leaderboards } = buildIndex('bat', [toyota, trang])
    // Winners boards are data-driven — one per (year, event) actually won —
    // so they are not part of this fixed roster.
    const ids = leaderboards.boards
      .filter(b => b.category !== 'winners')
      .map(b => b.id).sort()
    expect(ids).toEqual([
      'activity.matchesLast90', 'activity.tournamentsEntered',
      'character.comebacks', 'character.deciderRecord', 'character.threeGamers', 'character.threeSetterWins',
      'discipline.doubles.wins', 'discipline.mixed.wins', 'discipline.singles.wins',
      'headline.avgCourtTime', 'headline.courtTime', 'headline.titles', 'headline.winPct', 'headline.wins',
    ])
  })

  it('caps every ranked board at 25 entries', () => {
    const { leaderboards } = buildIndex('bat', [toyota, trang])
    // Winners boards are exempt: they list one row per tournament of the year
    // that crowned a champion in that event, and dropping the tail would hide
    // a real title rather than a long tail of also-rans.
    for (const b of leaderboards.boards) {
      if (b.category === 'winners') continue
      expect(b.entries.length).toBeLessThanOrEqual(25)
    }
  })

  it('ranks are 1-indexed and contiguous', () => {
    const { leaderboards } = buildIndex('bat', [toyota, trang])
    for (const b of leaderboards.boards) {
      b.entries.forEach((e, i) => expect(e.rank).toBe(i + 1))
    }
  })

  it('headline.winPct excludes players with < 20 matches', () => {
    const { index, leaderboards } = buildIndex('bat', [toyota, trang])
    const board = leaderboards.boards.find(b => b.id === 'headline.winPct')!
    for (const e of board.entries) {
      const p = index.players[e.slug]
      expect(p.totals.matches).toBeGreaterThanOrEqual(20)
    }
  })

  it('writes ranks back to PlayerRecord.ranks for ranked players', () => {
    const { index, leaderboards } = buildIndex('bat', [toyota, trang])
    const titlesBoard = leaderboards.boards.find(b => b.id === 'headline.titles')!
    if (titlesBoard.entries.length > 0) {
      const top = titlesBoard.entries[0]
      expect(index.players[top.slug].ranks.titles).toBe(1)
    }
  })

  it('headline.winPct display includes (wins/matches) behind the percent', () => {
    const players: Record<string, PlayerRecord> = {
      a: synthPlayer('a', 'Alpha', { wins: 17, losses: 3 }),  // 20 matches, qualifies
      b: synthPlayer('b', 'Beta',  { wins: 30, losses: 10 }), // 40 matches, qualifies
      c: synthPlayer('c', 'Gamma', { wins: 5,  losses: 4 }),  // 9 matches, below qualifier
    }
    const lb = buildLeaderboards('bat', players)
    const board = lb.boards.find(b => b.id === 'headline.winPct')!
    expect(board.entries.length).toBe(2)
    for (const e of board.entries) {
      const p = players[e.slug]
      expect(e.display).toMatch(/^\d+% \(\d+\/\d+\)$/)
      expect(e.display).toContain(`(${p.totals.wins}/${p.totals.matches})`)
    }
    // Spot-check Alpha specifically: 17/20 = 85%.
    const a = board.entries.find(e => e.slug === 'a')!
    expect(a.display).toBe('85% (17/20)')
  })

  it('headline.courtTime display includes (matchesWithDuration) behind the time', () => {
    const players: Record<string, PlayerRecord> = {
      a: synthPlayer('a', 'Alpha', { wins: 15, losses: 5, courtMinutes: 750, matchesWithDuration: 20 }),
      b: synthPlayer('b', 'Beta',  { wins: 10, losses: 5, courtMinutes: 90,  matchesWithDuration: 3  }),
      c: synthPlayer('c', 'Gamma', { wins: 5,  losses: 5, courtMinutes: 0,   matchesWithDuration: 0  }), // excluded
    }
    const lb = buildLeaderboards('bat', players)
    const board = lb.boards.find(b => b.id === 'headline.courtTime')!
    expect(board.entries.length).toBe(2)
    for (const e of board.entries) {
      const p = players[e.slug]
      expect(e.display).toMatch(/ \(\d+\)$/)
      expect(e.display).toContain(`(${p.matchCharacter.matchesWithDuration ?? 0})`)
    }
    // Alpha: 750 min = 12h 30m, 20 matches with a duration.
    const a = board.entries.find(e => e.slug === 'a')!
    expect(a.display).toBe('12h 30m (20)')
  })

  it('headline.courtTime falls back to (0) when matchesWithDuration is missing', () => {
    const players: Record<string, PlayerRecord> = {
      // Note: matchesWithDuration intentionally omitted (undefined) — simulates a stale index.
      a: synthPlayer('a', 'Stale', { wins: 10, losses: 5, courtMinutes: 60 }),
    }
    const lb = buildLeaderboards('bat', players)
    const board = lb.boards.find(b => b.id === 'headline.courtTime')!
    expect(board.entries[0].display).toBe('1h (0)')
  })

  it('character.deciderRecord display includes (wins/total) behind the percent', () => {
    const players: Record<string, PlayerRecord> = {
      // 6/10 = 60%, qualifies
      a: synthPlayer('a', 'Alpha', { wins: 6, losses: 4, threeSetterWins: 6, threeSetterCount: 10 }),
      // 5/8 = 62.5% → rounds to 63%, qualifies
      b: synthPlayer('b', 'Beta',  { wins: 5, losses: 3, threeSetterWins: 5, threeSetterCount: 8 }),
      // 4 three-setters, below the min5 qualifier
      c: synthPlayer('c', 'Gamma', { wins: 2, losses: 2, threeSetterWins: 2, threeSetterCount: 4 }),
    }
    const lb = buildLeaderboards('bat', players)
    const board = lb.boards.find(b => b.id === 'character.deciderRecord')!
    expect(board.entries.length).toBe(2)
    for (const e of board.entries) {
      const p = players[e.slug]
      expect(e.display).toMatch(/^\d+% \(\d+\/\d+\)$/)
      expect(e.display).toContain(`(${p.matchCharacter.threeSetterWins}/${p.matchCharacter.threeSetterCount})`)
    }
    // Spot-check Alpha: 6/10 = 60%.
    expect(board.entries.find(e => e.slug === 'a')!.display).toBe('60% (6/10)')
    expect(board.entries.find(e => e.slug === 'b')!.display).toBe('63% (5/8)')
  })

  it('character.deciderRecord breaks % ties by threeSetterCount desc', () => {
    // All three players sit at exactly 70% (7/10, 14/20, 21/30).
    // Tiebreaker should sort by threeSetterCount desc: c (30) > b (20) > a (10).
    const players: Record<string, PlayerRecord> = {
      a: synthPlayer('a', 'Alpha', { wins: 7,  losses: 3,  threeSetterWins: 7,  threeSetterCount: 10 }),
      b: synthPlayer('b', 'Beta',  { wins: 14, losses: 6,  threeSetterWins: 14, threeSetterCount: 20 }),
      c: synthPlayer('c', 'Gamma', { wins: 21, losses: 9,  threeSetterWins: 21, threeSetterCount: 30 }),
    }
    const lb = buildLeaderboards('bat', players)
    const board = lb.boards.find(b => b.id === 'character.deciderRecord')!
    expect(board.entries.map(e => e.slug)).toEqual(['c', 'b', 'a'])
    expect(board.entries.map(e => e.display)).toEqual([
      '70% (21/30)', '70% (14/20)', '70% (7/10)',
    ])
  })

  it('headline.avgCourtTime ranks by raw avg, qualifies on min 20 timed matches, displays "Xm (count)"', () => {
    const players: Record<string, PlayerRecord> = {
      // 30 timed matches, 900 min → 30 min avg
      a: synthPlayer('a', 'Alpha', { wins: 20, losses: 10, courtMinutes: 900, matchesWithDuration: 30 }),
      // 25 timed matches, 1000 min → 40 min avg (top)
      b: synthPlayer('b', 'Beta',  { wins: 18, losses: 7,  courtMinutes: 1000, matchesWithDuration: 25 }),
      // 20 timed matches, 720 min → 36 min avg
      c: synthPlayer('c', 'Gamma', { wins: 15, losses: 5,  courtMinutes: 720, matchesWithDuration: 20 }),
      // 19 timed matches → below qualifier, excluded
      d: synthPlayer('d', 'Delta', { wins: 12, losses: 7,  courtMinutes: 900, matchesWithDuration: 19 }),
    }
    const lb = buildLeaderboards('bat', players)
    const board = lb.boards.find(b => b.id === 'headline.avgCourtTime')!
    expect(board.category).toBe('headline')
    expect(board.qualifier).toBe('min20Timed')
    expect(board.entries.map(e => e.slug)).toEqual(['b', 'c', 'a'])
    expect(board.entries.map(e => e.display)).toEqual([
      '40m (25)', '36m (20)', '30m (30)',
    ])
  })
})

// ---------------------------------------------------------------------------
// Winners boards: per-event champion lists, grouped by year.
// ---------------------------------------------------------------------------

interface TitleSpec {
  tournamentId: string
  tournamentName: string
  dateIso: string
  eventName: string
  discipline?: Discipline
  partnerName?: string
}

/** A player record carrying nothing but the titles it won. Mirrors what
 *  buildIndex writes: every title appears both in `titles` and inside the
 *  matching `tournaments[].events` entry. */
function championPlayer(slug: string, name: string, club: string, titles: TitleSpec[]): PlayerRecord {
  const rec = synthPlayer(slug, name, { wins: titles.length, losses: 0 })
  rec.clubs = [club]
  const byTournament = new Map<string, PlayerRecord['tournaments'][number]>()
  for (const spec of titles) {
    const event: PlayerEventResult = {
      tournamentId: spec.tournamentId,
      eventId: `${spec.tournamentId}-${spec.eventName}`,
      eventName: spec.eventName,
      discipline: spec.discipline ?? 'singles',
      bestFinish: 'Champion',
      wins: 1, losses: 0,
      ...(spec.partnerName ? { partnerName: spec.partnerName } : {}),
    }
    rec.titles.push(event)
    let t = byTournament.get(spec.tournamentId)
    if (!t) {
      t = {
        tournamentId: spec.tournamentId,
        tournamentName: spec.tournamentName,
        tournamentDateIso: spec.dateIso,
        events: [],
      }
      byTournament.set(spec.tournamentId, t)
    }
    t.events.push(event)
  }
  rec.tournaments = Array.from(byTournament.values())
  return rec
}

const MALL = { tournamentId: 'T1', tournamentName: 'THE MALL 2025', dateIso: '2025-10-03' }
const PHIT = { tournamentId: 'T2', tournamentName: 'Phitsanulok Cup 2025', dateIso: '2025-10-09' }
const TRANG26 = { tournamentId: 'T3', tournamentName: 'Trang Open 2026', dateIso: '2026-04-17' }

describe('buildLeaderboards — winners boards', () => {
  it('builds one board per year and event, keyed winners-<year>-<event>', () => {
    const players: Record<string, PlayerRecord> = {
      a: championPlayer('a', 'Anuwat', 'Bangkok BC', [
        { ...MALL, eventName: 'BS U13' },
        { ...TRANG26, eventName: 'BS U13' },
      ]),
      b: championPlayer('b', 'Boon', 'Hat Yai', [{ ...MALL, eventName: 'GS U15' }]),
    }
    const lb = buildLeaderboards('bat', players)
    const ids = lb.boards.filter(b => b.category === 'winners').map(b => b.id)
    expect(ids).toEqual(expect.arrayContaining([
      'winners-2026-bs-u13', 'winners-2025-bs-u13', 'winners-2025-gs-u15',
    ]))
    expect(ids.filter(id => id.startsWith('winners-2025-')).length).toBe(2)
  })

  it('titles the board with the raw event label and tags it winners', () => {
    const players: Record<string, PlayerRecord> = {
      a: championPlayer('a', 'Anuwat', 'Bangkok BC', [{ ...MALL, eventName: 'XD U17', discipline: 'mixed', partnerName: 'Boon' }]),
      b: championPlayer('b', 'Boon', 'Hat Yai', [{ ...MALL, eventName: 'XD U17', discipline: 'mixed', partnerName: 'Anuwat' }]),
    }
    const lb = buildLeaderboards('bat', players)
    const board = lb.boards.find(b => b.id === 'winners-2025-xd-u17')!
    expect(board.titleKey).toBe('XD U17')
    expect(board.category).toBe('winners')
  })

  it('collapses a doubles title into one row naming both champions', () => {
    const players: Record<string, PlayerRecord> = {
      a: championPlayer('a', 'Anuwat', 'Bangkok BC', [{ ...MALL, eventName: 'BD U15', discipline: 'doubles', partnerName: 'Boon' }]),
      b: championPlayer('b', 'Boon', 'Bangkok BC', [{ ...MALL, eventName: 'BD U15', discipline: 'doubles', partnerName: 'Anuwat' }]),
    }
    const lb = buildLeaderboards('bat', players)
    const board = lb.boards.find(b => b.id === 'winners-2025-bd-u15')!
    expect(board.entries.length).toBe(1)
    const row = board.entries[0]
    // Both halves of the pairing are linkable: one on the row, one in partners.
    expect([row.slug, ...(row.partners ?? []).map(p => p.slug)].sort()).toEqual(['a', 'b'])
    expect([row.name, ...(row.partners ?? []).map(p => p.name)].sort()).toEqual(['Anuwat', 'Boon'])
  })

  it('names both clubs when a pairing is split across two', () => {
    const players: Record<string, PlayerRecord> = {
      a: championPlayer('a', 'Anuwat', 'Bangkok BC', [{ ...MALL, eventName: 'BD U15', discipline: 'doubles', partnerName: 'Boon' }]),
      b: championPlayer('b', 'Boon', 'Hat Yai', [{ ...MALL, eventName: 'BD U15', discipline: 'doubles', partnerName: 'Anuwat' }]),
    }
    const lb = buildLeaderboards('bat', players)
    const row = lb.boards.find(b => b.id === 'winners-2025-bd-u15')!.entries[0]
    expect(row.clubs).toEqual(['Bangkok BC', 'Hat Yai'])
  })

  it('leaves clubs unset when a singles row is covered by primaryClub', () => {
    const players: Record<string, PlayerRecord> = {
      a: championPlayer('a', 'Anuwat', 'Bangkok BC', [{ ...MALL, eventName: 'BS U13' }]),
    }
    const lb = buildLeaderboards('bat', players)
    const row = lb.boards.find(b => b.id === 'winners-2025-bs-u13')!.entries[0]
    expect(row.primaryClub).toBe('Bangkok BC')
    expect(row.clubs).toBeUndefined()
    expect(row.partners).toBeUndefined()
  })

  it('carries the tournament name and date, newest tournament first', () => {
    const players: Record<string, PlayerRecord> = {
      a: championPlayer('a', 'Anuwat', 'Bangkok BC', [{ ...MALL, eventName: 'BS U13' }]),
      b: championPlayer('b', 'Boon', 'Hat Yai', [{ ...PHIT, eventName: 'BS U13' }]),
    }
    const lb = buildLeaderboards('bat', players)
    const board = lb.boards.find(b => b.id === 'winners-2025-bs-u13')!
    expect(board.entries.map(e => e.tournamentName)).toEqual(['Phitsanulok Cup 2025', 'THE MALL 2025'])
    expect(board.entries.map(e => e.tournamentDateIso)).toEqual(['2025-10-09', '2025-10-03'])
    // `display` carries the date, not a second copy of the long name.
    expect(board.entries.map(e => e.display)).toEqual(['2025-10-09', '2025-10-03'])
    expect(board.entries.map(e => e.rank)).toEqual([1, 2])
  })

  it('orders boards newest year first, open events before age groups', () => {
    const t = (eventName: string, base = MALL) => ({ ...base, eventName })
    const players: Record<string, PlayerRecord> = {
      a: championPlayer('a', 'Anuwat', 'Bangkok BC', [
        t('BS U13'), t('MS'), t('GS U17'), t('WS'), t('BS U13', TRANG26),
      ]),
    }
    const lb = buildLeaderboards('bat', players)
    const ids = lb.boards.filter(b => b.category === 'winners').map(b => b.id)
    expect(ids).toEqual([
      'winners-2026-bs-u13',
      'winners-2025-ms', 'winners-2025-ws', 'winners-2025-gs-u17', 'winners-2025-bs-u13',
    ])
  })

  it('builds no winners boards for BWF, whose event labels are untreated', () => {
    const players: Record<string, PlayerRecord> = {
      a: championPlayer('a', 'Anuwat', 'Thailand', [{ ...MALL, eventName: 'MS' }]),
    }
    expect(buildLeaderboards('bwf', players).boards.filter(b => b.category === 'winners')).toEqual([])
    expect(buildLeaderboards('bat', players).boards.filter(b => b.category === 'winners').length).toBe(1)
  })

  it('builds no winners boards when nobody won a title', () => {
    const players: Record<string, PlayerRecord> = {
      a: synthPlayer('a', 'Alpha', { wins: 5, losses: 5 }),
    }
    const lb = buildLeaderboards('bat', players)
    expect(lb.boards.filter(b => b.category === 'winners')).toEqual([])
  })

  it('does not write winners rows back to PlayerRecord.ranks', () => {
    const players: Record<string, PlayerRecord> = {
      a: championPlayer('a', 'Anuwat', 'Bangkok BC', [{ ...MALL, eventName: 'BS U13' }]),
    }
    buildLeaderboards('bat', players)
    // `titles` is the headline board's rank field; no winners-specific key
    // should appear alongside it.
    expect(Object.keys(players.a.ranks).every(k => !k.startsWith('winners'))).toBe(true)
  })
})
