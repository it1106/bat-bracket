import type { MatchEntry, MatchPlayer, MatchScheduleGroup } from './types'

// Turns one day's schedule into the rows of a "team schedule" — the matches of
// whoever the current search or custom tab stands for, in playing order, each
// seen from the team's side. Pure: the caller says which matches and which
// sides belong to the team, so this stays in step with the search itself.

export interface TeamScheduleRow {
  /** Start time ("9:30"), an estimate ("~10:40"), or '' when the day has none. */
  when: string
  court: string
  /** "Match 3" on days played in court order, else ''. */
  order: string
  event: string
  round: string
  /** The team's side. In a derby (bothSides) this is simply side 1. */
  team: string[]
  opponent: string[]
  /** When the opponent is not known yet: the pairs or players who could be it
   *  (each one "A / B"), from the previous round. Empty when it is known. */
  opponentCandidates: string[]
  /** Both sides belong to the team, so there is no "won" or "lost". */
  bothSides: boolean
  status: 'upcoming' | 'live' | 'won' | 'lost' | 'played'
  /** Set scores with the team's points first, plus "W.O." / "Ret." */
  result: string
  /** "16:05" when the winner of a match still to be decided plays again the
   *  same day, else ''. */
  nextTime: string
}

export interface TeamMatcher {
  /** Is this one of the team's matches? */
  matches(entry: MatchEntry): boolean
  /** Does this side of the match belong to the team? */
  sideMatches(team: MatchPlayer[], entry: MatchEntry): boolean
}

const HHMM = /(\d{1,2}):(\d{2})/

function minutesOf(time: string | undefined): number | null {
  const m = time?.match(HHMM)
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

function rowOf(entry: MatchEntry, group: MatchScheduleGroup, matcher: TeamMatcher): { row: TeamScheduleRow; minutes: number | null } {
  const side1 = matcher.sideMatches(entry.team1, entry)
  const side2 = matcher.sideMatches(entry.team2, entry)
  // The team is on side 2 only when side 2 matches and side 1 does not.
  const flipped = side2 && !side1
  const bothSides = side1 === side2
  const team = flipped ? entry.team2 : entry.team1
  const opponent = flipped ? entry.team1 : entry.team2

  let when = ''
  let minutes: number | null = null
  if (group.type === 'time') {
    when = group.time
    minutes = minutesOf(group.time)
  } else {
    minutes = minutesOf(entry.scheduledTime)
    const hhmm = entry.scheduledTime?.match(HHMM)
    if (hhmm) when = `~${hhmm[0]}`
  }
  const orderNumber = entry.sequenceLabel?.match(/^\s*(\d+)\./)

  let status: TeamScheduleRow['status'] = 'upcoming'
  let result = ''
  if (entry.winner !== null) {
    status = bothSides ? 'played' : (entry.winner === 1) !== flipped ? 'won' : 'lost'
    const sets = entry.scores.map((s) => (flipped ? `${s.t2}-${s.t1}` : `${s.t1}-${s.t2}`)).join(', ')
    result = entry.walkover ? 'W.O.' : entry.retired ? `${sets} Ret.`.trim() : sets
  } else if (entry.nowPlaying) {
    status = 'live'
  }

  return {
    minutes,
    row: {
      when,
      // Some feeds ship the literal "Now playing" in place of a court.
      court: /^now\s*playing$/i.test(entry.court) ? '' : entry.court,
      order: orderNumber ? `Match ${orderNumber[1]}` : '',
      event: entry.draw,
      round: entry.round,
      team: team.map((p) => p.name),
      opponent: opponent.map((p) => p.name),
      opponentCandidates: opponent.length === 0
        ? (entry.tbdOpponents ?? []).map((side) => side.map((p) => p.name).join(' / ')).filter(Boolean)
        : [],
      bothSides,
      status,
      result,
      nextTime: entry.winner === null ? entry.winnerNextTime ?? '' : '',
    },
  }
}

export function buildTeamSchedule(groups: MatchScheduleGroup[], matcher: TeamMatcher): TeamScheduleRow[] {
  const rows = groups.flatMap((group) =>
    group.matches.filter((m) => matcher.matches(m)).map((m) => rowOf(m, group, matcher)),
  )
  // By time of day where known; rows without a time keep their schedule order
  // and follow the timed ones. sort() is stable, so ties keep that order too.
  rows.sort((a, b) => (a.minutes ?? Infinity) - (b.minutes ?? Infinity))
  return rows.map(({ row }) => row)
}
