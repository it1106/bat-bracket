import type { BracketRound, MatchPlayer, MatchScore } from './types'

export interface PathTeam {
  team: MatchPlayer[]
  seed?: string
}

export interface PathRound {
  round: string
  status: 'won' | 'lost' | 'next' | 'future' | 'bye'
  /** The opponent, when the bracket already names one. */
  opponent?: MatchPlayer[]
  opponentSeed?: string
  /** From the player's point of view: `t1` is the player's side. */
  scores?: MatchScore[]
  walkover?: boolean
  retired?: boolean
  time?: string
  date?: string
  court?: string
  /** Everyone who can still fill the opposing row, when it is not decided. */
  candidates?: PathTeam[]
}

export interface BracketPath {
  /** The player, with their partner in doubles, as the bracket lists them. */
  team: MatchPlayer[]
  seed?: string
  eliminated: boolean
  champion: boolean
  rounds: PathRound[]
}

type Side = 0 | 1

const holds = (team: MatchPlayer[], playerId: string) => team.some((p) => p.playerId === playerId)

const teamOf = (team: MatchPlayer[], seed: string | undefined): PathTeam =>
  seed ? { team, seed } : { team }

/** The teams that can still occupy row `side` of match `i` in round `r`.
 *  A row already filled is that team. Otherwise the answer comes from the
 *  feeder match `2i + side` of the round before: its winner if it is decided,
 *  or else whoever can still fill either of its rows. A team that has lost is
 *  never returned, because a decided feeder only ever yields its winner. */
function possibleFrom(rounds: BracketRound[], r: number, i: number, side: Side): PathTeam[] {
  const match = rounds[r]?.matches[i]
  if (!match) return []
  if (match.teams[side].length > 0) return [teamOf(match.teams[side], match.seeds[side])]
  if (r === 0) return []

  const feederIdx = 2 * i + side
  const feeder = rounds[r - 1].matches[feederIdx]
  if (!feeder) return []
  if (feeder.winner !== null) {
    const w = (feeder.winner - 1) as Side
    return feeder.teams[w].length > 0 ? [teamOf(feeder.teams[w], feeder.seeds[w])] : []
  }
  return [
    ...possibleFrom(rounds, r - 1, feederIdx, 0),
    ...possibleFrom(rounds, r - 1, feederIdx, 1),
  ]
}

/** One player's route through a knockout bracket, from the round they enter
 *  to the final. Null when the player is not in the bracket. */
export function buildBracketPath(rounds: BracketRound[], playerId: string): BracketPath | null {
  if (!playerId) return null

  let r = -1
  let i = -1
  let side: Side = 0
  search: for (let ri = 0; ri < rounds.length; ri++) {
    const matches = rounds[ri].matches
    for (let mi = 0; mi < matches.length; mi++) {
      for (const s of [0, 1] as Side[]) {
        if (holds(matches[mi].teams[s], playerId)) { r = ri; i = mi; side = s; break search }
      }
    }
  }
  if (r < 0) return null

  const entry = rounds[r].matches[i]
  const team = entry.teams[side]
  const seed = entry.seeds[side]
  const out: PathRound[] = []
  let eliminated = false
  let champion = false
  // Once one round is still to be played, every round after it is further off.
  let pending = false

  for (; r < rounds.length; r++) {
    const match = rounds[r].matches[i]
    if (!match) break
    const round = rounds[r].name
    const placed: Side | null = holds(match.teams[0], playerId) ? 0 : holds(match.teams[1], playerId) ? 1 : null
    const mine: Side = placed ?? side
    const other = (1 - mine) as Side
    const schedule = {
      ...(match.time && { time: match.time }),
      ...(match.date && { date: match.date }),
      ...(match.court && { court: match.court }),
    }

    if (placed !== null && match.winner !== null) {
      const won = match.winner - 1 === mine
      if (won && match.teams[other].length === 0) {
        out.push({ round, status: 'bye' })
      } else {
        out.push({
          round,
          status: won ? 'won' : 'lost',
          opponent: match.teams[other],
          ...(match.seeds[other] && { opponentSeed: match.seeds[other] }),
          scores: mine === 0 ? match.scores : match.scores.map((s) => ({ t1: s.t2, t2: s.t1 })),
          walkover: match.walkover,
          retired: match.retired,
          ...schedule,
        })
      }
      if (!won) { eliminated = true; break }
      if (r === rounds.length - 1) champion = true
    } else {
      const candidates = possibleFrom(rounds, r, i, other)
      if (candidates.length === 0) {
        out.push({ round, status: 'bye' })
      } else if (!pending && match.teams[other].length > 0) {
        out.push({
          round,
          status: 'next',
          opponent: match.teams[other],
          ...(match.seeds[other] && { opponentSeed: match.seeds[other] }),
          ...schedule,
        })
        pending = true
      } else {
        out.push({ round, status: pending ? 'future' : 'next', candidates, ...schedule })
        pending = true
      }
    }

    side = (i % 2) as Side
    i = Math.floor(i / 2)
  }

  return { team, ...(seed && { seed }), eliminated, champion, rounds: out }
}
