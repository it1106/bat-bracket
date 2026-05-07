import type { DiscoveryStore } from './discovery-store'
import type { TournamentInfo } from './types'

export function mergeForApi(
  manualEntries: TournamentInfo[],
  denySet: Set<string>,
  discovered: DiscoveryStore,
): TournamentInfo[] {
  const byId = new Map<string, TournamentInfo>()
  for (const e of discovered.entries) {
    if (!e.hasBracket) continue
    byId.set(e.id, { id: e.id, name: e.name })
  }
  // Manual wins on conflict.
  for (const e of manualEntries) {
    byId.set(e.id, e)
  }
  return Array.from(byId.values()).filter((e) => !denySet.has(e.id))
}

// Newest-first by startDateIso. Entries without a startDateIso sink to the
// bottom and preserve their relative order. Pure: never mutates input.
export function sortNewestFirst(entries: TournamentInfo[]): TournamentInfo[] {
  const indexed = entries.map((e, i) => ({ e, i }))
  indexed.sort((a, b) => {
    const aHas = !!a.e.startDateIso
    const bHas = !!b.e.startDateIso
    if (aHas && !bHas) return -1
    if (!aHas && bHas) return 1
    if (!aHas && !bHas) return a.i - b.i
    return (b.e.startDateIso ?? '').localeCompare(a.e.startDateIso ?? '')
  })
  return indexed.map((x) => x.e)
}
