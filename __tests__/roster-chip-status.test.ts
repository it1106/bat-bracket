import { aggregate } from '@/lib/tournamentStats'
import type { MatchEntry, MatchesData, MatchScheduleGroup, MatchPlayer } from '@/lib/types'

// Build one match. `round`/`eventName`/`winner` override the round-robin-free
// defaults so we can model finals, semis, knockout rounds and group draws.
function match(
  draw: string,
  round: string,
  t1: MatchPlayer[],
  t2: MatchPlayer[],
  winner: 1 | 2 | null,
  eventName?: string,
): MatchEntry {
  return {
    draw, drawNum: draw, round,
    team1: t1, team2: t2,
    winner, scores: [],
    court: '', walkover: false, retired: false, nowPlaying: false,
    ...(eventName ? { eventName } : {}),
  }
}

// THA squad, one player per outcome we want to assert on.
const champ = { name: 'Champ', playerId: 'c', country: 'THA' }
const runner = { name: 'Runner', playerId: 'r', country: 'THA' }
const semi = { name: 'Semi', playerId: 's', country: 'THA' }
const early = { name: 'Early', playerId: 'e', country: 'THA' }
const alive = { name: 'Alive', playerId: 'a', country: 'THA' }
const foe = { name: 'Foe', playerId: 'f', country: 'THA' }

function statusFor(stats: ReturnType<typeof aggregate>, pid: string, event: string) {
  const tha = stats.countryRosters.find((c) => c.country === 'THA')!
  const m = tha.roster!.find((x) => x.playerId === pid)!
  return m.statusByEvent?.[event]
}

function knockoutData(): { data: MatchesData; days: Map<string, MatchScheduleGroup[]> } {
  const group: MatchScheduleGroup = {
    type: 'time', time: '10:00',
    matches: [
      // Final: Champ beats Runner
      match('MS', 'Final', [champ], [runner], 1),
      // Semi: Champ beats Semi (Semi ⇒ bronze); Runner beats Foe
      match('MS', 'Semi Final', [champ], [semi], 1),
      match('MS', 'Semi Final', [runner], [foe], 1),
      // Quarter Final: Champ beats Early (Early ⇒ out); Alive wins their QF ⇒ still in
      match('MS', 'Quarter Final', [champ], [early], 1),
      match('MS', 'Quarter Final', [alive], [foe], 1),
    ],
  }
  const data: MatchesData = {
    days: [{ date: '01/07', label: '01/07', dateIso: '2026-07-01', hasMatches: true }],
    currentDate: '2026-07-01',
    groups: [group],
  }
  return { data, days: new Map([['2026-07-01', [group]]]) }
}

describe('roster chip status — knockout event', () => {
  it('assigns gold/silver/bronze/out/in from bracket results', () => {
    const { data, days } = knockoutData()
    const stats = aggregate(data, days, {})
    expect(statusFor(stats, 'c', 'MS')).toBe('gold')
    expect(statusFor(stats, 'r', 'MS')).toBe('silver')
    expect(statusFor(stats, 's', 'MS')).toBe('bronze')
    expect(statusFor(stats, 'e', 'MS')).toBe('out')
    expect(statusFor(stats, 'a', 'MS')).toBe('in')
  })
})

describe('roster chip status — group stage', () => {
  it('keeps group players in during the group phase, out once the playoff is seeded and they missed it', () => {
    const qwin = { name: 'Qwin', playerId: 'qw', country: 'THA' }
    const qout = { name: 'Qout', playerId: 'qo', country: 'THA' }
    const opp = { name: 'Opp', playerId: 'op', country: 'THA' }

    // Group phase only: nobody dimmed yet (no playoff draw seeded).
    const groupsOnly: MatchScheduleGroup = {
      type: 'time', time: '09:00',
      matches: [
        match('WS - Group A', 'Round Robin', [qwin], [qout], 1, 'WS'),
      ],
    }
    const dataG: MatchesData = {
      days: [{ date: '01/07', label: '01/07', dateIso: '2026-07-01', hasMatches: true }],
      currentDate: '2026-07-01', groups: [groupsOnly],
    }
    const statsG = aggregate(dataG, new Map([['2026-07-01', [groupsOnly]]]), {})
    expect(statusFor(statsG, 'qo', 'WS')).toBe('in') // group loss does NOT dim
    expect(statusFor(statsG, 'qw', 'WS')).toBe('in')

    // Playoff seeded (a 'WS' draw exists) with qwin but not qout ⇒ qout out.
    const withPlayoff: MatchScheduleGroup = {
      type: 'time', time: '09:00',
      matches: [
        match('WS - Group A', 'Round Robin', [qwin], [qout], 1, 'WS'),
        match('WS', 'Semi Final', [qwin], [opp], null, 'WS'),
      ],
    }
    const dataP: MatchesData = {
      days: [{ date: '01/07', label: '01/07', dateIso: '2026-07-01', hasMatches: true }],
      currentDate: '2026-07-01', groups: [withPlayoff],
    }
    const statsP = aggregate(dataP, new Map([['2026-07-01', [withPlayoff]]]), {})
    expect(statusFor(statsP, 'qo', 'WS')).toBe('out')  // eliminated in groups, absent from playoff
    expect(statusFor(statsP, 'qw', 'WS')).toBe('in')   // reached playoff, still playing
  })
})
