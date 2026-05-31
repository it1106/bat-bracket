import type { DiscoveryStore } from './discovery-store'
import type { TournamentInfo } from './types'

export function mergeForApi(
  manualEntries: TournamentInfo[],
  denySet: Set<string>,
  discovered: DiscoveryStore,
  denyNamePatterns: readonly string[] = [],
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
  // Patterns are pre-lowercased by the parser; one pass over each entry's name.
  const matchesAnyPattern = (name: string): boolean => {
    if (denyNamePatterns.length === 0) return false
    const folded = name.toLowerCase()
    for (const p of denyNamePatterns) {
      if (folded.includes(p)) return true
    }
    return false
  }
  return Array.from(byId.values()).filter(
    (e) => !denySet.has(e.id) && !matchesAnyPattern(e.name),
  )
}

// Sort tournaments for the dropdown: active first (earliest startDateIso at
// the top so the next event up is most prominent), then done (newest first
// so the most recent past event is on top of that group). Within each
// bucket, entries without startDateIso sink to the bottom and preserve their
// relative order. Pure: never mutates input.
export function sortTournamentsForDropdown(entries: TournamentInfo[]): TournamentInfo[] {
  const indexed = entries.map((e, i) => ({ e, i }))

  const compareWithin = (
    a: { e: TournamentInfo; i: number },
    b: { e: TournamentInfo; i: number },
    direction: 'asc' | 'desc',
  ): number => {
    const aHas = !!a.e.startDateIso
    const bHas = !!b.e.startDateIso
    if (aHas && !bHas) return -1
    if (!aHas && bHas) return 1
    if (!aHas && !bHas) return a.i - b.i
    const cmp = (a.e.startDateIso ?? '').localeCompare(b.e.startDateIso ?? '')
    return direction === 'asc' ? cmp : -cmp
  }

  indexed.sort((a, b) => {
    const aDone = !!a.e.done
    const bDone = !!b.e.done
    if (aDone !== bDone) return aDone ? 1 : -1
    return compareWithin(a, b, aDone ? 'desc' : 'asc')
  })

  return indexed.map((x) => x.e)
}
