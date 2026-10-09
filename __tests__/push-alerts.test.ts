import { dueAlerts, dueResults, normalizeClub, sentKeyFor, endpointHash } from '@/lib/push/alerts'
import type { PushFollow, PushSubscriptionRecord } from '@/lib/push/types'
import type { MatchEntry, MatchPlayer, MatchScheduleGroup } from '@/lib/types'

const TID = 'AAAAAAAA-0000-0000-0000-000000000001'
const DAY = '2026-10-09'
const P = (id: string): MatchPlayer => ({ name: `P${id}`, playerId: id })

const m = (a: string[], b: string[], over: Partial<MatchEntry> = {}): MatchEntry => ({
  draw: 'BS U15', drawNum: '21', round: 'Round of 32',
  team1: a.map(P), team2: b.map(P),
  winner: null, scores: [], court: 'Court 1', walkover: false, retired: false, nowPlaying: false,
  ...over,
})

/** One time-slot group; the queue is the order given. */
const day = (...matches: MatchEntry[]): MatchScheduleGroup[] => [{ type: 'time', time: '9:00', matches }]

const player = (playerId: string): PushFollow =>
  ({ kind: 'player', tournamentId: TID, playerId, playerName: `P${playerId}`, addedAt: '' })
const club = (clubName: string): PushFollow => ({ kind: 'club', tournamentId: TID, clubName, addedAt: '' })

const device = (name: string, follows: PushFollow[], lang: 'en' | 'th' = 'en'): PushSubscriptionRecord => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/${name}`,
  keys: { p256dh: 'p', auth: 'a' }, lang, follows, createdAt: '', lastSeenAt: '',
})

const decide = (
  groups: MatchScheduleGroup[],
  records: PushSubscriptionRecord[],
  over: { sent?: Set<string>; clubs?: Record<string, string>; now?: number } = {},
) => dueAlerts({
  tournamentId: TID, dateIso: DAY, groups, records,
  nowMinutes: over.now ?? 12 * 60,
  clubOf: (id) => over.clubs?.[id],
  alreadySent: (k) => over.sent?.has(k) ?? false,
})

const brief = (alerts: ReturnType<typeof decide>) =>
  alerts.map((a) => `${a.endpoint.split('/').pop()}:${a.stage}:${a.match.team1[0].playerId}v${a.match.team2[0].playerId}@${a.position}`)

// A played match first, so the queue starts after it.
const DONE = m(['90'], ['91'], { winner: 1 })
const queue = () => day(DONE, m(['1'], ['2']), m(['3'], ['4']), m(['5'], ['6']), m(['7'], ['8']), m(['9'], ['10']), m(['11'], ['12']))

describe('dueAlerts — when', () => {
  it('is "next" at the front of the queue', () => {
    expect(brief(decide(queue(), [device('a', [player('1')])]))).toEqual(['a:next:1v2@1'])
  })

  it('is "soon" at two, three and four places from the front', () => {
    expect(brief(decide(queue(), [device('a', [player('3')])]))).toEqual(['a:soon:3v4@2'])
    expect(brief(decide(queue(), [device('a', [player('5')])]))).toEqual(['a:soon:5v6@3'])
    expect(brief(decide(queue(), [device('a', [player('7')])]))).toEqual(['a:soon:7v8@4'])
  })

  it('is nothing further back', () => {
    expect(decide(queue(), [device('a', [player('9'), player('11')])])).toEqual([])
  })

  it('never alerts a finished, walked-over or now-playing match', () => {
    const groups = day(m(['1'], ['2'], { winner: 2 }), m(['3'], ['4'], { walkover: true, winner: 1 }), m(['5'], ['6'], { nowPlaying: true }))
    expect(decide(groups, [device('a', [player('1'), player('3'), player('5')])])).toEqual([])
  })

  it('never alerts a court-sequenced day', () => {
    const groups: MatchScheduleGroup[] = [{ type: 'court', court: 'Court 1', matches: [m(['1'], ['2'])] }]
    expect(decide(groups, [device('a', [player('1')])])).toEqual([])
  })

  it('is nothing for an empty day or with nobody following', () => {
    expect(decide([], [device('a', [player('1')])])).toEqual([])
    expect(decide(queue(), [])).toEqual([])
    expect(decide(queue(), [device('a', [])])).toEqual([])
  })

  it('ignores follows in another tournament', () => {
    const other: PushFollow = { kind: 'player', tournamentId: 'BBBBBBBB-0000-0000-0000-000000000002', playerId: '1', playerName: 'P1', addedAt: '' }
    expect(decide(queue(), [device('a', [other])])).toEqual([])
  })

  it('matches the tournament id whatever its case', () => {
    const lower = { ...player('1'), tournamentId: TID.toLowerCase() } as PushFollow
    expect(brief(decide(queue(), [device('a', [lower])]))).toEqual(['a:next:1v2@1'])
  })
})

describe('dueAlerts — once', () => {
  it('does not repeat an alert already sent', () => {
    const a = device('a', [player('3')])
    const first = decide(queue(), [a])
    expect(first).toHaveLength(1)
    expect(decide(queue(), [a], { sent: new Set(first.flatMap((x) => x.covers)) })).toEqual([])
  })

  it('sends "next" after "soon" was sent', () => {
    const a = device('a', [player('3')])
    const soon = decide(queue(), [a])
    const sent = new Set(soon.flatMap((x) => x.covers))
    const later = day(DONE, m(['1'], ['2'], { winner: 1 }), m(['3'], ['4']), m(['5'], ['6']))
    expect(brief(decide(later, [a], { sent }))).toEqual(['a:next:3v4@1'])
  })

  it('a match first seen at the front settles "soon" too, so it cannot arrive afterwards', () => {
    const a = device('a', [player('1')])
    const next = decide(queue(), [a])
    expect(next[0].covers).toHaveLength(2)
    const sent = new Set(next.flatMap((x) => x.covers))
    // the organisers push the match back three places
    const reordered = day(DONE, m(['3'], ['4']), m(['5'], ['6']), m(['1'], ['2']))
    expect(decide(reordered, [a], { sent })).toEqual([])
  })

  it('keeps a key stable when the schedule is re-read in another order', () => {
    const one = sentKeyFor('https://e/1', TID, DAY, m(['1'], ['2']), 'next')
    const two = sentKeyFor('https://e/1', TID.toLowerCase(), DAY, m(['2'], ['1']), 'next')
    expect(one).toBe(two)
    expect(sentKeyFor('https://e/2', TID, DAY, m(['1'], ['2']), 'next')).not.toBe(one)
    expect(sentKeyFor('https://e/1', TID, DAY, m(['1'], ['2']), 'soon')).not.toBe(one)
    expect(sentKeyFor('https://e/1', TID, '2026-10-10', m(['1'], ['2']), 'next')).not.toBe(one)
    expect(one).not.toContain('https://')
    expect(endpointHash('https://e/1')).toHaveLength(16)
  })
})

describe('dueAlerts — who', () => {
  it('sends each device its own alert', () => {
    const out = decide(queue(), [device('a', [player('1')]), device('b', [player('2')]), device('c', [player('5')])])
    expect(brief(out).sort()).toEqual(['a:next:1v2@1', 'b:next:1v2@1', 'c:soon:5v6@3'])
  })

  it('names two followed players in one match together, in one alert', () => {
    const out = decide(queue(), [device('a', [player('1'), player('2')])])
    expect(out).toHaveLength(1)
    expect(out[0].players.map((p) => p.playerId).sort()).toEqual(['1', '2'])
  })

  it('finds a doubles pair by either partner', () => {
    const groups = day(DONE, m(['1', '9'], ['2', '8']))
    expect(decide(groups, [device('a', [player('9')])])[0].players.map((p) => p.playerId)).toEqual(['9'])
  })

  it('carries the device language', () => {
    expect(decide(queue(), [device('a', [player('1')], 'th')])[0].lang).toBe('th')
  })
})

describe('dueAlerts — clubs', () => {
  const clubs = { '1': 'Red Club', '3': 'Red Club', '4': 'Blue Club', '9': 'Red  club ' }

  it('brings in every member\'s match', () => {
    const out = decide(queue(), [device('a', [club('Red Club')])], { clubs })
    expect(brief(out).sort()).toEqual(['a:next:1v2@1', 'a:soon:3v4@2'])
    expect(out[0].clubs).toEqual(['Red Club'])
  })

  it('compares club names without regard to case or spacing', () => {
    const groups = day(DONE, m(['9'], ['10']))
    expect(decide(groups, [device('a', [club('red club')])], { clubs })).toHaveLength(1)
    expect(normalizeClub('  Red   CLUB ')).toBe('red club')
    expect(normalizeClub(undefined)).toBe('')
  })

  it('alerts once for a player followed directly and through a club', () => {
    const out = decide(queue(), [device('a', [player('1'), club('Red Club')])], { clubs })
    const first = out.filter((a) => a.match.team1[0].playerId === '1')
    expect(first).toHaveLength(1)
    expect(first[0].players.map((p) => p.playerId)).toEqual(['1'])
    expect(first[0].clubs).toEqual(['Red Club'])
  })

  it('alerts once for one partner followed and the other partner\'s club followed', () => {
    const groups = day(DONE, m(['7', '3'], ['2', '8']))
    const out = decide(groups, [device('a', [player('7'), club('Red Club')])], { clubs })
    expect(out).toHaveLength(1)
    expect(out[0].players.map((p) => p.playerId).sort()).toEqual(['3', '7'])
  })

  it('names both sides when two followed clubs meet', () => {
    const out = decide(day(DONE, m(['3'], ['4'])), [device('a', [club('Red Club'), club('Blue Club')])], { clubs })
    expect(out).toHaveLength(1)
    expect(out[0].players.map((p) => p.playerId).sort()).toEqual(['3', '4'])
    expect(out[0].clubs.slice().sort()).toEqual(['Blue Club', 'Red Club'])
  })

  it('does nothing for a player with no club, or when the club map is missing', () => {
    expect(decide(queue(), [device('a', [club('Red Club')])], { clubs: {} })).toEqual([])
    expect(decide(queue(), [device('a', [club('Red Club')])])).toEqual([])
  })

  it('never treats an empty club name as a club', () => {
    expect(decide(queue(), [device('a', [club('  ')])], { clubs: { '1': '' } })).toEqual([])
  })
})

describe('dueAlerts — before play has started', () => {
  // A fresh day: nothing played, nothing on court. The queue rule alone would
  // call the first match "next" from midnight on.
  const fresh = (time: string): MatchScheduleGroup[] => [{ type: 'time', time, matches: [m(['1'], ['2']), m(['3'], ['4'])] }]
  const both = [device('a', [player('1'), player('3')])]
  const at = (h: number, min: number) => h * 60 + min

  it('sends nothing at midnight for matches that start in the morning', () => {
    expect(decide(fresh('9:00'), both, { now: at(0, 1) })).toEqual([])
  })

  it('sends nothing to someone who follows hours before the first slot', () => {
    expect(decide(fresh('9:00'), both, { now: at(7, 30) })).toEqual([])
    expect(decide(fresh('9:00'), both, { now: at(8, 29) })).toEqual([])
  })

  it('alerts the first matches once their slot is half an hour away', () => {
    expect(brief(decide(fresh('9:00'), both, { now: at(8, 30) })).sort()).toEqual(['a:next:1v2@1', 'a:soon:3v4@2'])
  })

  it('still alerts a first slot that is running late', () => {
    expect(decide(fresh('9:00'), both, { now: at(9, 20) })).toHaveLength(2)
  })

  it('holds back a later slot of a day that has not started', () => {
    const groups: MatchScheduleGroup[] = [
      { type: 'time', time: '9:00', matches: [m(['1'], ['2'])] },
      { type: 'time', time: '13:00', matches: [m(['3'], ['4'])] },
    ]
    expect(brief(decide(groups, both, { now: at(8, 45) }))).toEqual(['a:next:1v2@1'])
  })

  it('does not guess for a slot whose time cannot be read', () => {
    expect(decide(fresh('TBA'), both, { now: at(9, 0) })).toEqual([])
  })

  it('reads a time written with a leading zero or a dot', () => {
    expect(decide(fresh('09:00'), both, { now: at(8, 40) })).toHaveLength(2)
    expect(decide(fresh('9.00'), both, { now: at(8, 40) })).toHaveLength(2)
  })

  it('goes by the queue alone once a match has been played or is on court', () => {
    expect(decide(queue(), [device('a', [player('1')])], { now: at(0, 1) })).toHaveLength(1)
    const live = day(m(['90'], ['91'], { nowPlaying: true }), m(['1'], ['2']))
    expect(decide(live, [device('a', [player('1')])], { now: at(0, 1) })).toHaveLength(1)
  })

  it('a walkover alone does not count as play having started', () => {
    const groups: MatchScheduleGroup[] = [{ type: 'time', time: '9:00', matches: [m(['90'], ['91'], { walkover: true, winner: 1 }), m(['1'], ['2'])] }]
    expect(decide(groups, [device('a', [player('1')])], { now: at(0, 1) })).toEqual([])
  })
})

describe('dueAlerts — an opponent not yet decided', () => {
  it('waits until both sides are known, then alerts once', () => {
    const a = device('a', [player('1')])
    const waiting = day(DONE, m(['7'], ['8']), m(['1'], []))
    expect(decide(waiting, [a])).toEqual([])
    const known = day(DONE, m(['7'], ['8']), m(['1'], ['2']))
    const first = decide(known, [a])
    expect(brief(first)).toEqual(['a:soon:1v2@2'])
    expect(decide(known, [a], { sent: new Set(first.flatMap((x) => x.covers)) })).toEqual([])
  })

  it('does not alert a match with nobody in it', () => {
    expect(decide(day(DONE, m([], [])), [device('a', [player('1')])])).toEqual([])
  })
})

describe('dueResults', () => {
  const SEEN = Date.UTC(2026, 9, 9, 5, 0)
  const before = new Date(SEEN - 60_000).toISOString()
  const after = new Date(SEEN + 60_000).toISOString()
  const since = (playerId: string, addedAt: string): PushFollow => ({ kind: 'player', tournamentId: TID, playerId, playerName: `P${playerId}`, addedAt })
  const done = m(['1'], ['2'], { winner: 1, scores: [{ t1: 15, t2: 2 }] })
  const results = (
    groups: MatchScheduleGroup[],
    records: PushSubscriptionRecord[],
    over: { sent?: Set<string>; seen?: (m: MatchEntry) => number | undefined } = {},
  ) => dueResults({
    tournamentId: TID, dateIso: DAY, groups, records,
    alreadySent: (k) => over.sent?.has(k) ?? false,
    resultSeenAt: over.seen ?? (() => SEEN),
  })

  it('reports a result the watcher saw arrive, to a device following a player in it', () => {
    const out = results(day(done, m(['3'], ['4'])), [device('a', [since('2', before)])])
    expect(out).toHaveLength(1)
    expect(out[0].stage).toBe('result')
    expect(out[0].players.map((p) => p.playerId)).toEqual(['2'])
    expect(out[0].covers).toEqual([sentKeyFor(out[0].endpoint, TID, DAY, done, 'result')])
  })

  it('says nothing about a result that was already there when the watcher first looked', () => {
    expect(results(day(done), [device('a', [since('1', before)])], { seen: () => undefined })).toEqual([])
  })

  it('says nothing to someone who followed after the result came in', () => {
    expect(results(day(done), [device('a', [since('1', after)])])).toEqual([])
  })

  it('does not report through a club follow', () => {
    expect(results(day(done), [device('a', [club('Red')])])).toEqual([])
  })

  it('reports a walkover, and does not repeat a result already sent', () => {
    const wo = m(['1'], ['2'], { winner: 2, walkover: true })
    const first = results(day(wo), [device('a', [since('1', before)])])
    expect(first).toHaveLength(1)
    expect(results(day(wo), [device('a', [since('1', before)])], { sent: new Set([first[0].sentKey]) })).toEqual([])
  })

  it('reports one result once to a device following both players, and separately to each device', () => {
    const out = results(day(done), [device('a', [since('1', before), since('2', before)]), device('b', [since('2', before)])])
    expect(out.map((a) => `${a.endpoint.split('/').pop()}:${a.players.map((p) => p.playerId).join('+')}`)).toEqual(['a:1+2', 'b:2'])
  })

  it('ignores unfinished matches and follows in another tournament', () => {
    const other: PushFollow = { kind: 'player', tournamentId: 'BBBBBBBB-0000-0000-0000-000000000002', playerId: '1', playerName: 'P1', addedAt: before }
    expect(results(day(m(['1'], ['2'])), [device('a', [since('1', before)])])).toEqual([])
    expect(results(day(done), [device('a', [other])])).toEqual([])
  })
})
