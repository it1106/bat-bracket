import type { MatchPlayer, PlayerIndex, Ranking } from './types'
import type { PathRound } from './bracketPath'
import { nameToSlug } from './playerIndex'

export interface PathRecord {
  wins: number
  losses: number
}

export interface PathCandidate {
  team: MatchPlayer[]
  seed?: string
  rank?: number
  /** Null when there is no history to count from; 0–0 is a real answer. */
  record: PathRecord | null
  favourite: boolean
}

export interface PathRoundOut extends Omit<PathRound, 'candidates'> {
  /** Past record against a known next opponent. */
  record?: PathRecord | null
  candidates?: PathCandidate[]
}

export interface PathResponse {
  team: MatchPlayer[]
  seed?: string
  eliminated: boolean
  champion: boolean
  rounds: PathRoundOut[]
  /** The bracket this was built from is past its refresh time. */
  stale: boolean
}

const DRAW_RE = /^(BS|GS|BD|GD|XD|MS|WS|MD|WD)(?:\s+U\s*(\d+))?$/i
const DISCIPLINE: Record<string, string> = {
  BS: 'MS', GS: 'WS', BD: 'MD', GD: 'WD', XD: 'MXD', MS: 'MS', WS: 'WS', MD: 'MD', WD: 'WD',
}
// Boys'/girls' draws exist only by age group; without one there is no
// ranking event to point at.
const JUNIOR_ONLY = new Set(['BS', 'GS', 'BD', 'GD'])

/** The BAT ranking event a draw's players are ranked in: "BS U15" → "U15_MS",
 *  "XD" → "MXD". Null for a draw with no ranking of its own. */
export function rankingEventCodeForDraw(drawName: string): string | null {
  const m = drawName.replace(/\s*\([^)]*\)\s*$/, '').trim().match(DRAW_RE)
  if (!m) return null
  const kind = m[1].toUpperCase()
  const age = m[2]
  if (!age) return JUNIOR_ONLY.has(kind) ? null : DISCIPLINE[kind]
  return `U${age}_${DISCIPLINE[kind]}`
}

/** An order-free key for a set of names. nameToSlug drops seed marks and
 *  folds case and spacing, so the bracket, the index and the ranking agree. */
function slugKey(names: string[]): string {
  return names.map((n) => nameToSlug(n)).filter(Boolean).sort().join('|')
}

/** What else is known about a bracket player beyond the spelling of their
 *  name: the curated alias for the ranking's spelling, and the ranking ids
 *  they carry (one per ranking series). */
export interface RankIdentity {
  aliasSlug?: string
  globalPlayerIds?: string[]
}

/** The team's position in a ranking event: the row naming exactly these
 *  players. A player matches a row member by name, by alias, or by ranking
 *  id, so a name the two sources spell differently is still found. Undefined
 *  when the event or the row is not there. */
export function teamRank(
  ranking: Ranking | null,
  eventCode: string,
  team: MatchPlayer[],
  identify: (slug: string) => RankIdentity = () => ({}),
): number | undefined {
  const ev = ranking?.events.find((e) => e.eventCode === eventCode)
  if (!ev) return undefined
  const who = team
    .map((p) => nameToSlug(p.name))
    .filter(Boolean)
    .map((slug) => ({ slug, ...identify(slug) }))
  if (who.length === 0) return undefined

  const row = ev.entries.find((e) => {
    const members = e.players && e.players.length > 0
      ? e.players
      : [{ slug: e.slug, globalPlayerId: e.globalPlayerId }]
    if (members.length !== who.length) return false
    // Each player takes a different member, so a pair never matches a row
    // that merely contains one of them twice over.
    const free = new Set(members.map((_, i) => i))
    return who.every((w) => {
      const hit = members.findIndex((m, i) => free.has(i) && (
        m.slug === w.slug ||
        (!!w.aliasSlug && m.slug === w.aliasSlug) ||
        (!!m.globalPlayerId && !!w.globalPlayerIds?.includes(m.globalPlayerId))
      ))
      if (hit < 0) return false
      free.delete(hit)
      return true
    })
  })
  return row?.rank
}

/** Past meetings between two teams, from the matches the player index holds.
 *  In doubles both pairs must be the same two players. */
export function pairRecord(
  index: PlayerIndex | null,
  team: MatchPlayer[],
  opponent: MatchPlayer[],
): PathRecord | null {
  if (!index || team.length === 0 || opponent.length === 0) return null
  // Either partner's history holds the pair's matches; use whoever has one.
  const self = team.find((p) => index.players[nameToSlug(p.name)]?.tournamentMatches)
  if (!self) return null
  const matches = index.players[nameToSlug(self.name)].tournamentMatches!

  const partners = slugKey(team.filter((p) => p !== self).map((p) => p.name))
  const opp = slugKey(opponent.map((p) => p.name))
  let wins = 0
  let losses = 0
  for (const list of Object.values(matches)) {
    for (const m of list) {
      if (slugKey(m.opponents) !== opp) continue
      if (slugKey(m.partners) !== partners) continue
      if (m.outcome === 'W' || m.outcome === 'WO-W' || m.outcome === 'RET-W') wins++
      else losses++
    }
  }
  return { wins, losses }
}

/** The number a seed sorts by: "3/4" → 3. */
export function seedNumber(seed: string | undefined): number | undefined {
  const n = parseInt((seed ?? '').trim(), 10)
  return Number.isNaN(n) ? undefined : n
}

type Unranked = Omit<PathCandidate, 'favourite'>

/** Index of the favourite: the lowest seed; a shared lowest seed, or no seeds
 *  at all, is settled by ranking position; -1 when nothing separates them. */
function favouriteIndex(c: Unranked[]): number {
  if (c.length === 0) return -1
  if (c.length === 1) return 0
  const seeds = c.map((x) => seedNumber(x.seed))
  const known = seeds.filter((s): s is number => s !== undefined)
  const all = c.map((_, i) => i)
  const pool = known.length > 0 ? all.filter((i) => seeds[i] === Math.min(...known)) : all
  if (pool.length === 1) return pool[0]

  const ranked = pool.filter((i) => c[i].rank !== undefined)
  if (ranked.length === 0) return -1
  const best = Math.min(...ranked.map((i) => c[i].rank!))
  const top = ranked.filter((i) => c[i].rank === best)
  return top.length === 1 ? top[0] : -1
}

/** Marks the favourite and sorts: favourite first, then by seed, ranking
 *  position and name, with the unseeded and unranked last. */
export function rankCandidates(candidates: Unranked[]): PathCandidate[] {
  const fav = favouriteIndex(candidates)
  const far = Number.POSITIVE_INFINITY
  return candidates
    .map((c, i) => ({ ...c, favourite: i === fav }))
    .sort((a, b) =>
      Number(b.favourite) - Number(a.favourite) ||
      (seedNumber(a.seed) ?? far) - (seedNumber(b.seed) ?? far) ||
      (a.rank ?? far) - (b.rank ?? far) ||
      (a.team[0]?.name ?? '').localeCompare(b.team[0]?.name ?? ''))
}
