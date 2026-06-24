import type {
  RankingPlayerDetail, PlayerEventResult, RankingPlayerTournament,
} from '@/lib/types'
import { ProjectionRow, projectPlayer } from '@/lib/ranking/projection'
import { disciplineOf, weekSortKey, type Discipline } from '@/lib/ranking/player-view'
import { ageGroupFromEvent, pointsFor, pointsRoundFromResult } from '@/lib/points/bat-points'
import type { CohortPlayer } from '@/lib/ranking/u15-cohort'

/** Every detail row of the board's `discipline`, credit = the row's own
 *  `points`. Do NOT key on `countsTowardRankingsParsed` — that array is
 *  populated ONLY for currently-counting rows, so keying on it hides the 11th+
 *  rows Rule 2 must promote on expiry. Every U15 cohort member is U15-eligible,
 *  so each of their results in this discipline credits the board at its own
 *  points (verified on prod for singles/doubles/mixed). Gender is handled by
 *  cohort membership, so discipline is the only filter needed. */
export function buildBaseRows(detail: RankingPlayerDetail, discipline: Discipline): ProjectionRow[] {
  const out: ProjectionRow[] = []
  for (const t of detail.tournaments as RankingPlayerTournament[]) {
    if (disciplineOf(t.sourceEvent) !== discipline) continue
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

/** Recent singles results from the index, pointed via the engine, restricted to
 *  tournaments NEWER than the official snapshot horizon (`horizonWeek` = the
 *  most recent week present in any cohort player's official detail). A
 *  tournament at or before the horizon is already in the published ranking, so
 *  re-adding it would double-count — and because our index and BAT's detail
 *  disagree on both tournament name (sponsor prefixes) and ISO week for the
 *  same event, the temporal horizon is the only reliable "already counted"
 *  signal. Caller has already restricted `events` to one player. */
export function buildAddedRows(
  events: PlayerEventResult[],
  ctx: AddCtx,
  horizonWeek: string,
  discipline: Discipline,
): ProjectionRow[] {
  const out: ProjectionRow[] = []
  for (const e of events) {
    if (e.discipline !== discipline) continue                // only this board's discipline
    const week = ctx.weekOf(e.tournamentId)
    if (!week) continue
    if (weekSortKey(week) <= weekSortKey(horizonWeek)) continue // already in the snapshot
    const age = ageGroupFromEvent(e.eventName)
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
  discipline: Discipline
  detailOf: (gid: string) => Promise<RankingPlayerDetail | null>
  eventsOf: (slug: string) => PlayerEventResult[]
  addCtx: AddCtx
}

/** Most recent ISO week present across every player's official base rows — the
 *  snapshot horizon. Tournaments newer than this are the genuinely un-counted
 *  ones the projection adds. */
export function snapshotHorizonWeek(allBaseRows: ProjectionRow[][]): string {
  let horizon = ''
  for (const rows of allBaseRows) {
    for (const r of rows) {
      if (weekSortKey(r.week) > weekSortKey(horizon || '0000-00')) horizon = r.week
    }
  }
  return horizon
}

/** Project every cohort player, re-rank by projected total, compute Δ. */
export async function assembleProjectedBoard(
  cohort: CohortPlayer[],
  deps: AssembleDeps,
): Promise<ProjectedEntry[]> {
  // First pass: load every player's official base rows (one detail read each)
  // and derive the global snapshot horizon from them.
  const loaded = await Promise.all(cohort.map(async p => {
    const detail = await deps.detailOf(p.globalPlayerId)
    return { p, base: detail ? buildBaseRows(detail, deps.discipline) : [] }
  }))
  const horizon = snapshotHorizonWeek(loaded.map(l => l.base))

  const scored = loaded.map(({ p, base }) => {
    const added = buildAddedRows(deps.eventsOf(p.slug), deps.addCtx, horizon, deps.discipline)
    const { projectedTotal } = projectPlayer(base, added, deps.publishDate)
    return { p, projectedPoints: projectedTotal }
  })
  scored.sort((a, b) => b.projectedPoints - a.projectedPoints || a.p.officialRank - b.p.officialRank)
  return scored.map((s, i) => ({
    slug: s.p.slug, name: s.p.name,
    officialRank: s.p.officialRank, officialPoints: s.p.officialPoints,
    projectedRank: i + 1, projectedPoints: s.projectedPoints,
    delta: s.p.officialRank - (i + 1),
  }))
}
