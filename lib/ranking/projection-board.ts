import type {
  RankingPlayerDetail, PlayerEventResult, RankingPlayerTournament,
} from '@/lib/types'
import { ProjectionRow, projectPlayer, tournamentKey } from '@/lib/ranking/projection'
import { disciplineOf } from '@/lib/ranking/player-view'
import { ageGroupFromEvent, pointsFor, pointsRoundFromResult } from '@/lib/points/bat-points'
import type { CohortPlayer } from '@/lib/ranking/u15-cohort'

/** Every boys-SINGLES detail row, credit = the row's own `points`. Do NOT key
 *  on `countsTowardRankingsParsed` — that array is populated ONLY for currently-
 *  counting rows, so keying on it hides the 11th+ rows Rule 2 must promote on
 *  expiry. For the U15 pilot every cohort member is U15-eligible, so each of
 *  their singles results credits U15 at its own points. (When the pilot widens
 *  to other boards this will need a per-event credit model + a target param.) */
export function buildBaseRows(detail: RankingPlayerDetail): ProjectionRow[] {
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
  // Identify already-counted tournaments by name+discipline (NOT week — the
  // index and the official detail can label the same tournament with different
  // ISO weeks, which previously caused double-counting).
  const seen = new Set(baseRows.map(r => tournamentKey(r.tournamentName, r.sourceEvent)))
  const out: ProjectionRow[] = []
  for (const e of events) {
    if (e.discipline !== 'singles') continue                 // U15 Boys *singles* board
    const week = ctx.weekOf(e.tournamentId)
    if (!week) continue
    const age = ageGroupFromEvent(e.eventName)
    const name = ctx.nameOf(e.tournamentId)
    if (seen.has(tournamentKey(name, e.eventName))) continue // already counted officially
    const level = ctx.levelOf(e.tournamentId)
    const round = pointsRoundFromResult(e.bestFinish, e.wins, e.drawSize, e.lostByWalkover, e.active)
    const credit = level && age && round ? pointsFor(level, age, round) : null
    if (!credit) continue
    out.push({ week, sourceEvent: e.eventName, tournamentName: name, credit })
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
}

/** Project every cohort player, re-rank by projected total, compute Δ. */
export async function assembleProjectedBoard(
  cohort: CohortPlayer[],
  deps: AssembleDeps,
): Promise<ProjectedEntry[]> {
  const scored = await Promise.all(cohort.map(async p => {
    const detail = await deps.detailOf(p.globalPlayerId)
    const base = detail ? buildBaseRows(detail) : []
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
