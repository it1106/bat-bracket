import { createHash } from 'crypto'
import type {
  PlayerIndex, PlayerRecord, Leaderboards, PlayerIdentityMap,
  DisciplineSummary, PlayerMatchRef, OpponentRecord, PartnerRecord,
} from './types'
import { buildLeaderboards } from './playerIndex'

function mergeDisc(a: DisciplineSummary, b: DisciplineSummary): DisciplineSummary {
  return { wins: a.wins + b.wins, losses: a.losses + b.losses, titles: a.titles + b.titles, finals: a.finals + b.finals, semis: a.semis + b.semis }
}

function mergeRecentForm(a: PlayerMatchRef[], b: PlayerMatchRef[]): PlayerMatchRef[] {
  return [...a, ...b]
    .sort((x, y) => (y.scheduledDateIso || '').localeCompare(x.scheduledDateIso || ''))
    .slice(0, 10)
}

function mergeMatchCharacter(
  a: PlayerRecord['matchCharacter'],
  b: PlayerRecord['matchCharacter'],
  mergedTotals: PlayerRecord['totals'],
): PlayerRecord['matchCharacter'] {
  const courtMinutes = a.courtMinutes + b.courtMinutes
  const withDurA = a.avgMatchMinutes > 0 ? Math.round(a.courtMinutes / a.avgMatchMinutes) : 0
  const withDurB = b.avgMatchMinutes > 0 ? Math.round(b.courtMinutes / b.avgMatchMinutes) : 0
  const withDur = withDurA + withDurB
  const avgMatchMinutes = withDur > 0 ? Math.round(courtMinutes / withDur) : 0
  const threeSetterCount = a.threeSetterCount + b.threeSetterCount
  const threeSetterWins = a.threeSetterWins + b.threeSetterWins
  const decidedMatches = mergedTotals.matches - mergedTotals.walkoversReceived - mergedTotals.walkoversGiven
  const threeSetterRate = decidedMatches > 0 ? threeSetterCount / decidedMatches : 0
  const longestMatchMinutes = Math.max(a.longestMatchMinutes, b.longestMatchMinutes)
  const longestMatchRef = a.longestMatchMinutes >= b.longestMatchMinutes ? a.longestMatchRef : b.longestMatchRef
  const comebackWins = a.comebackWins + b.comebackWins
  let comebackWinRef = a.comebackWinRef
  if (!comebackWinRef) { comebackWinRef = b.comebackWinRef }
  else if (b.comebackWinRef) {
    if (b.comebackWinRef.round === 'Final' && a.comebackWinRef?.round !== 'Final') comebackWinRef = b.comebackWinRef
    else if ((b.comebackWinRef.scheduledDateIso || '') > (a.comebackWinRef?.scheduledDateIso || '')) comebackWinRef = b.comebackWinRef
  }
  return {
    courtMinutes, avgMatchMinutes, longestMatchMinutes, longestMatchRef,
    threeSetterCount, threeSetterRate, threeSetterWins,
    comebackWins, firstGameLost: a.firstGameLost + b.firstGameLost,
    comebackWinRef, matchesLast90: a.matchesLast90 + b.matchesLast90,
  }
}

function mergeOpponents(a: OpponentRecord[], b: OpponentRecord[]): OpponentRecord[] {
  const map = new Map<string, OpponentRecord>()
  for (const r of [...a, ...b]) {
    const e = map.get(r.slug)
    if (!e) { map.set(r.slug, { ...r }); continue }
    e.meetings += r.meetings; e.wins += r.wins; e.losses += r.losses
  }
  return Array.from(map.values())
    .sort((x, y) => y.meetings - x.meetings || y.wins - x.wins || x.slug.localeCompare(y.slug))
    .slice(0, 12)
}

function mergePartners(a: PartnerRecord[], b: PartnerRecord[]): PartnerRecord[] {
  const map = new Map<string, PartnerRecord>()
  for (const r of [...a, ...b]) {
    const e = map.get(r.slug)
    if (!e) { map.set(r.slug, { ...r }); continue }
    e.matchesTogether += r.matchesTogether; e.wins += r.wins; e.losses += r.losses
  }
  return Array.from(map.values())
    .sort((x, y) => y.matchesTogether - x.matchesTogether || y.wins - x.wins || x.slug.localeCompare(y.slug))
    .slice(0, 12)
}

function mergePlayerRecords(bat: PlayerRecord, bwf: PlayerRecord): PlayerRecord {
  const totals = {
    matches: bat.totals.matches + bwf.totals.matches,
    wins: bat.totals.wins + bwf.totals.wins,
    losses: bat.totals.losses + bwf.totals.losses,
    walkoversReceived: bat.totals.walkoversReceived + bwf.totals.walkoversReceived,
    walkoversGiven: bat.totals.walkoversGiven + bwf.totals.walkoversGiven,
    retirementsReceived: bat.totals.retirementsReceived + bwf.totals.retirementsReceived,
    retirementsGiven: bat.totals.retirementsGiven + bwf.totals.retirementsGiven,
  }
  const altNames = [...new Set([...bat.altNames, bwf.displayName, ...bwf.altNames])].filter(n => n !== bat.displayName)
  const sortByDate = <T extends { tournamentDateIso: string }>(arr: T[]) =>
    arr.sort((a, b) => b.tournamentDateIso.localeCompare(a.tournamentDateIso))
  return {
    key: bat.key,
    displayName: bat.displayName,
    altNames,
    clubs: bat.clubs,
    country: bwf.country,
    totals,
    byDiscipline: {
      singles: mergeDisc(bat.byDiscipline.singles, bwf.byDiscipline.singles),
      doubles: mergeDisc(bat.byDiscipline.doubles, bwf.byDiscipline.doubles),
      mixed:   mergeDisc(bat.byDiscipline.mixed,   bwf.byDiscipline.mixed),
    },
    titles:      sortByDate([...bat.titles,      ...bwf.titles]),
    finals:      sortByDate([...bat.finals,      ...bwf.finals]),
    semis:       sortByDate([...bat.semis,        ...bwf.semis]),
    tournaments: sortByDate([...bat.tournaments, ...bwf.tournaments]),
    recentForm: mergeRecentForm(bat.recentForm, bwf.recentForm),
    matchCharacter: mergeMatchCharacter(bat.matchCharacter, bwf.matchCharacter, totals),
    opponents: mergeOpponents(bat.opponents, bwf.opponents),
    partners:  mergePartners(bat.partners,  bwf.partners),
    ranks: {},
  }
}

export function buildCombinedIndex(
  batIndex: PlayerIndex,
  bwfIndex: PlayerIndex,
  identityMap: PlayerIdentityMap,
): { index: PlayerIndex; leaderboards: Leaderboards } {
  const bwfToBat = new Map<string, string>()
  const batToBwf = new Map<string, string>()
  for (const m of identityMap.matches) {
    if (m.rejected) continue
    bwfToBat.set(m.bwfSlug, m.batSlug)
    batToBwf.set(m.batSlug, m.bwfSlug)
  }

  const players: Record<string, PlayerRecord> = {}
  const batSlugs = new Set(Object.keys(batIndex.players))

  for (const [slug, batPlayer] of Object.entries(batIndex.players)) {
    const bwfSlug = batToBwf.get(slug)
    const bwfPlayer = bwfSlug ? bwfIndex.players[bwfSlug] : undefined
    players[slug] = bwfPlayer ? mergePlayerRecords(batPlayer, bwfPlayer) : { ...batPlayer }
  }

  for (const [slug, bwfPlayer] of Object.entries(bwfIndex.players)) {
    if (bwfPlayer.country !== 'THA') continue
    if (bwfToBat.has(slug)) continue
    players[slug] = { ...bwfPlayer }
  }

  const index: PlayerIndex = {
    version: 1,
    provider: 'combined',
    generatedAt: '__GENERATED_AT__',
    sourceVersion: '',
    sources: [...batIndex.sources, ...bwfIndex.sources],
    totalPlayers: Object.keys(players).length,
    totalMatches: batIndex.totalMatches + bwfIndex.totalMatches,
    players,
  }

  const leaderboards = buildLeaderboards('combined', players)

  for (const board of leaderboards.boards) {
    for (const entry of board.entries) {
      entry.provider = batSlugs.has(entry.slug) ? 'bat' : 'bwf'
    }
  }

  return { index, leaderboards }
}

export function combinedSourceVersion(batSV: string, bwfSV: string): string {
  return createHash('sha256').update(`combined|${batSV}|${bwfSV}`).digest('hex')
}
