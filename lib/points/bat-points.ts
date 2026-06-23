// Pure BAT ranking-points engine. The 2563 (2020) accumulated-points tables
// are reproduced exactly by a closed-form formula (verified against all 294
// published cells), so we generate values rather than hardcode them.

export type AgeGroup = 'Open' | 'U19' | 'U17' | 'U15' | 'U13' | 'U11' | 'U9'

// Table rows, best → worst.
export type PointsRound = 'Winner' | 'RunnerUp' | 'SF' | 'QF' | 'R16' | 'R32' | 'R64'

export const AGE_GROUPS: AgeGroup[] = ['Open', 'U19', 'U17', 'U15', 'U13', 'U11', 'U9']
export const POINTS_ROUNDS: PointsRound[] = ['Winner', 'RunnerUp', 'SF', 'QF', 'R16', 'R32', 'R64']

export const ROUND_LABELS: Record<PointsRound, string> = {
  Winner: 'Winner',
  RunnerUp: 'Runner-Up',
  SF: 'round 3/4',
  QF: 'Round 5/8',
  R16: 'Round 9/16',
  R32: 'Round 17/32',
  R64: 'Round 33/64',
}

const BASE = 40000

// Open=1, U19=0.625, then ×0.64 per step down.
const AGE_FACTOR: Record<AgeGroup, number> = {
  Open: 1,
  U19: 0.625,
  U17: 0.625 * 0.64,
  U15: 0.625 * 0.64 ** 2,
  U13: 0.625 * 0.64 ** 3,
  U11: 0.625 * 0.64 ** 4,
  U9: 0.625 * 0.64 ** 5,
}

const ROUND_INDEX: Record<PointsRound, number> = {
  Winner: 0, RunnerUp: 1, SF: 2, QF: 3, R16: 4, R32: 5, R64: 6,
}

export function pointsFor(level: number, age: AgeGroup, round: PointsRound): number {
  return Math.round(BASE * 0.8 ** (level - 1) * AGE_FACTOR[age] * 0.8 ** ROUND_INDEX[round])
}

export function levelTable(level: number): Record<AgeGroup, number[]> {
  const out = {} as Record<AgeGroup, number[]>
  for (const age of AGE_GROUPS) {
    out[age] = POINTS_ROUNDS.map((r) => pointsFor(level, age, r))
  }
  return out
}

const AGE_FROM_NUM: Record<number, AgeGroup> = {
  9: 'U9', 11: 'U11', 13: 'U13', 15: 'U15', 17: 'U17', 19: 'U19',
}

// Parse the age group from an event name. "BS U15" → U15; "MS"/"XD" → Open;
// U-ages outside the table (U7, U23) → null.
export function ageGroupFromEvent(eventName: string): AgeGroup | null {
  const m = eventName.match(/U\s*(\d{1,2})/i)
  if (!m) return 'Open'
  return AGE_FROM_NUM[Number(m[1])] ?? null
}

// bestFinish (actual exit round) → row, used once the player has won a match.
// R128 / RR fall outside the published table.
const ROUND_FROM_FINISH: Record<string, PointsRound> = {
  Champion: 'Winner', F: 'RunnerUp', SF: 'SF', QF: 'QF', R16: 'R16', R32: 'R32', R64: 'R64',
}

// drawSize (the draw's opening-round size) → the first-round-loss row, used for
// a 0-win player. 128+ is off table.
const SIZE_TO_ROUND: Record<number, PointsRound> = {
  2: 'RunnerUp', 4: 'SF', 8: 'QF', 16: 'R16', 32: 'R32', 64: 'R64',
}

// Decide the points row for a player's result, applying the bye rule:
//  - Champion → Winner.
//  - Won ≥1 match → the round they actually reached (bestFinish). A bye earlier
//    in the run does not demote a player who went on to win a match.
//  - Won 0 matches → first-round loss, credited at the draw's opening round
//    (this is the only branch the bye rule corrects, and the only one needing
//    drawSize). Walkovers-received already count toward `wins`; byes never do.
// Returns null when no row applies (off-table round, group-only, or a 0-win
// result with no drawSize available).
export function pointsRoundFromResult(
  bestFinish: string,
  wins: number,
  drawSize: number | undefined,
): PointsRound | null {
  if (bestFinish === 'Champion') return 'Winner'
  if (wins <= 0) return drawSize ? SIZE_TO_ROUND[drawSize] ?? null : null
  return ROUND_FROM_FINISH[bestFinish] ?? null
}
