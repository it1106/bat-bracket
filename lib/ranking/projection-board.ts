import type {
  RankingPlayerDetail, PlayerEventResult, RankingPlayerTournament,
} from '@/lib/types'
import { ProjectionRow, projectPlayer } from '@/lib/ranking/projection'
import { weekSortKey, disciplineOf } from '@/lib/ranking/player-view'
import { ageGroupFromEvent, pointsFor, pointsRoundFromResult } from '@/lib/points/bat-points'
import type { CohortPlayer } from '@/lib/ranking/u15-cohort'

/** Normalized identity for "the same tournament-result toward a board":
 *  ISO-week + discipline class + age number. Robust to the differing event-name
 *  formats between the detail (sourceEvent "BS U15") and the index
 *  (eventName "Boys' Singles U15"). */
function resultKey(week: string, discipline: string | null, age: string | null): string {
  return `${weekSortKey(week)}::${discipline ?? '?'}::${age ?? '?'}`
}

/** Every boys-SINGLES detail row, credit = the row's own `points`. Do NOT key
 *  on `countsTowardRankingsParsed` — that array is populated ONLY for currently-
 *  counting rows, so keying on it hides the 11th+ rows Rule 2 must promote on
 *  expiry. For the U15 pilot every cohort member is U15-eligible, so each of
 *  their singles results credits U15 at its own points. `targetEvent` is a
 *  forward-looking hook; this body assumes "every singles row credits the
 *  target", valid for the single-age-board pilot. */
export function buildBaseRows(detail: RankingPlayerDetail, _targetEvent: string): ProjectionRow[] {
  const out: ProjectionRow[] = []
  for (const t of detail.tournaments as RankingPlayerTournament[]) {
    if (disciplineOf(t.sourceEvent) !== 'singles') continue
    out.push({ week: t.week, sourceEvent: t.sourceEvent, tournamentName: t.tournamentName, credit: t.points })
  }
  return out
}

export interface AddCtx {
  levelOf: (tournamentId: string) => number | undefined
  nameOf: (tournamentId: string) => string
  weekOf: (tournamentId: string) => string | null
}

// NOTE: live/in-progress tournaments need no special handling here. The index
// already carries them as `active: true` events, and `pointsRoundFromResult`
// (called below) applies the next-round floor for active events. The index
// auto-rebuilds ~every 15 min during live play, so advancement is reflected
// within that window — no live-bracket path required (decision: 2026-06-24).

/** Recent singles results from the index, pointed via the engine, excluding
 *  any already represented among `baseRows` (the official detail). Caller has
 *  already restricted `events` to one player. */
export function buildAddedRows(
  events: PlayerEventResult[],
  baseRows: ProjectionRow[],
  ctx: AddCtx,
): ProjectionRow[] {
  const seen = new Set(baseRows.map(r => resultKey(r.week, disciplineOf(r.sourceEvent), ageGroupFromEvent(r.sourceEvent))))
  const out: ProjectionRow[] = []
  for (const e of events) {
    if (e.discipline !== 'singles') continue                 // U15 Boys *singles* board
    const week = ctx.weekOf(e.tournamentId)
    if (!week) continue
    const age = ageGroupFromEvent(e.eventName)
    const key = resultKey(week, 'singles', age)
    if (seen.has(key)) continue                              // already counted officially
    const level = ctx.levelOf(e.tournamentId)
    const round = pointsRoundFromResult(e.bestFinish, e.wins, e.drawSize, e.lostByWalkover, e.active)
    const credit = level && age && round ? pointsFor(level, age, round) : null
    if (!credit) continue
    out.push({ week, sourceEvent: e.eventName, tournamentName: ctx.nameOf(e.tournamentId), credit })
  }
  return out
}

export interface ProjectedEntry {
  slug: string
  name: string
  officialRank: number
  officialPoints: number
  projectedRank: number
  projectedPoints: number
  delta: number          // officialRank - projectedRank (positive = moved up)
}

export interface AssembleDeps {
  publishDate: string
  detailOf: (gid: string) => Promise<RankingPlayerDetail | null>
  eventsOf: (slug: string) => PlayerEventResult[]
  addCtx: AddCtx
  targetEvent: string
}

/** Project every cohort player, re-rank by projected total, compute Δ. */
export async function assembleProjectedBoard(
  cohort: CohortPlayer[],
  deps: AssembleDeps,
): Promise<ProjectedEntry[]> {
  const scored = await Promise.all(cohort.map(async p => {
    const detail = await deps.detailOf(p.globalPlayerId)
    const base = detail ? buildBaseRows(detail, deps.targetEvent) : []
    const added = buildAddedRows(deps.eventsOf(p.slug), base, deps.addCtx)
    const { projectedTotal } = projectPlayer(base, added, deps.publishDate)
    return { p, projectedPoints: projectedTotal }
  }))
  scored.sort((a, b) => b.projectedPoints - a.projectedPoints || a.p.officialRank - b.p.officialRank)
  return scored.map((s, i) => ({
    slug: s.p.slug, name: s.p.name,
    officialRank: s.p.officialRank, officialPoints: s.p.officialPoints,
    projectedRank: i + 1, projectedPoints: s.projectedPoints,
    delta: s.p.officialRank - (i + 1),
  }))
}
