import type {
  RankingPlayerDetail, PlayerEventResult, RankingPlayerTournament,
} from '@/lib/types'
import { ProjectionRow, projectPlayer } from '@/lib/ranking/projection'
import { disciplineOf, type Discipline } from '@/lib/ranking/player-view'
import { ageGroupFromEvent, pointsFor, pointsRoundFromResult } from '@/lib/points/bat-points'
import type { CohortPlayer } from '@/lib/ranking/u15-cohort'

/** Every detail row of the board's `discipline` **and** age tier, credit = the
 *  row's own `points`. Do NOT key on `countsTowardRankingsParsed` — that array
 *  is populated ONLY for currently-counting rows, so keying on it hides the
 *  11th+ rows Rule 2 must promote on expiry. That's also why the age tier is
 *  matched on `sourceEvent` rather than read off the markers: since BAT split
 *  its list, a result credits only its own age group's ranking (a U15 player's
 *  BS U17 result feeds the U17 list alone, and a U13 result carries nothing
 *  down — BAT has no BWF-style discounted carry), and an uncounted 11th row
 *  has no marker to read the tier from. Gender is handled by cohort
 *  membership, so discipline + tier are the only filters needed. */
export function buildBaseRows(
  detail: RankingPlayerDetail,
  discipline: Discipline,
  ageTier: number,
): ProjectionRow[] {
  const out: ProjectionRow[] = []
  for (const t of detail.tournaments as RankingPlayerTournament[]) {
    if (disciplineOf(t.sourceEvent) !== discipline) continue
    if (ageGroupFromEvent(t.sourceEvent) !== `U${ageTier}`) continue
    out.push({
      week: t.week, sourceEvent: t.sourceEvent, tournamentName: t.tournamentName,
      credit: t.points, tournamentId: t.tournamentId ? t.tournamentId.toUpperCase() : null,
    })
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

/** The set of tournaments already represented in this player's official rows
 *  for this board — the exact "already counted" test. `null` when any base row
 *  has no resolvable tournament id: the set would then be incomplete, and an
 *  incomplete set silently re-admits a counted tournament as an add, which
 *  double-counts. Callers treat null as "add nothing for this player" —
 *  understating a projection is recoverable, inflating it is not. In practice
 *  this only fires on a cache written before detail rows carried ids (dropped
 *  on read by the v3 bump) or if BAT changes its markup. */
export function countedTournamentIds(baseRows: ProjectionRow[]): Set<string> | null {
  const ids = new Set<string>()
  for (const r of baseRows) {
    if (!r.tournamentId) return null
    ids.add(r.tournamentId)
  }
  return ids
}

/** Recent singles results from the index, pointed via the engine, restricted to
 *  tournaments NOT already present in this player's official rows for the board
 *  (`countedIds`, from `countedTournamentIds`). Re-adding a counted tournament
 *  would double-count, and the tournament GUID is the only identifier BAT's
 *  detail and our index agree on — they disagree on both name (sponsor
 *  prefixes) and ISO week for the same event.
 *
 *  This used to be a temporal test: skip anything at or before the most recent
 *  week in *any* cohort player's detail. A week is too coarse. BAT's
 *  publication cutoff falls inside a week, so week 2026-36 held both Jorakay
 *  (processed into the 8/9/2569 edition) and Ponsana (not) — and the horizon
 *  swallowed Ponsana for every player, silently understating them by a full
 *  tournament. Identity has no such blind spot. Caller has already restricted
 *  `events` to one player; `countedIds === null` means add nothing. */
export function buildAddedRows(
  events: PlayerEventResult[],
  ctx: AddCtx,
  countedIds: Set<string> | null,
  discipline: Discipline,
  ageTier: number,
): ProjectionRow[] {
  if (!countedIds) return []
  const out: ProjectionRow[] = []
  for (const e of events) {
    if (e.discipline !== discipline) continue                // only this board's discipline
    const id = e.tournamentId?.toUpperCase()
    if (!id) continue                                        // malformed index row
    if (countedIds.has(id)) continue                         // already in the snapshot
    const week = ctx.weekOf(id)
    if (!week) continue
    const age = ageGroupFromEvent(e.eventName)
    if (age !== `U${ageTier}`) continue                      // and only its age group
    const level = ctx.levelOf(id)
    const round = pointsRoundFromResult(e.bestFinish, e.wins, e.drawSize, e.lostByWalkover, e.active)
    const credit = level && age && round ? pointsFor(level, age, round) : null
    if (!credit) continue
    out.push({ week, sourceEvent: e.eventName, tournamentName: ctx.nameOf(id), credit, tournamentId: id })
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
  /** `U<NN>` tier the board ranks; rows from other age groups credit their own
   *  ranking, not this one. */
  ageTier: number
  detailOf: (gid: string) => Promise<RankingPlayerDetail | null>
  eventsOf: (slug: string) => PlayerEventResult[]
  addCtx: AddCtx
}

/** Project every cohort player, re-rank by projected total, compute Δ. */
export async function assembleProjectedBoard(
  cohort: CohortPlayer[],
  deps: AssembleDeps,
): Promise<ProjectedEntry[]> {
  // One detail read per player. De-duplication is per-player and by tournament
  // id, so nothing has to be derived across the cohort first.
  const scored = await Promise.all(cohort.map(async p => {
    const detail = await deps.detailOf(p.globalPlayerId)
    const base = detail ? buildBaseRows(detail, deps.discipline, deps.ageTier) : []
    // No detail at all is not "no tournaments counted" — it's an unknown set,
    // which must add nothing rather than add everything.
    const counted = detail ? countedTournamentIds(base) : null
    const added = buildAddedRows(deps.eventsOf(p.slug), deps.addCtx, counted, deps.discipline, deps.ageTier)
    const { projectedTotal } = projectPlayer(base, added, deps.publishDate)
    return { p, projectedPoints: projectedTotal }
  }))
  scored.sort((a, b) => b.projectedPoints - a.projectedPoints || a.p.officialRank - b.p.officialRank)
  // Standard competition ranking ("1224"): equal points share a rank, and the
  // next distinct score skips accordingly (A=10000→1, B=10000→1, C=9000→3).
  let lastRank = 0
  let lastPoints = Number.NaN
  return scored.map((s, i) => {
    const rank = s.projectedPoints === lastPoints ? lastRank : i + 1
    lastRank = rank
    lastPoints = s.projectedPoints
    return {
      slug: s.p.slug, name: s.p.name,
      officialRank: s.p.officialRank, officialPoints: s.p.officialPoints,
      projectedRank: rank, projectedPoints: s.projectedPoints,
      delta: s.p.officialRank - rank,
    }
  })
}
