import type { TournamentInfo } from './types'

export interface PriorEditionWinnerEntry {
  players: string[]
  club?: string
  priorEditionId: string
  priorEditionLabel: string
}
export type PriorEditionWinnerMap = Map<string, PriorEditionWinnerEntry>

function canonicalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/[‘’“”'"`]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\b(19|20)\d{2}\b/g, ' ')
    .replace(/\b(open|championship|championships|\d+(st|nd|rd|th))\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function idPrefix(id: string): string {
  const m = id.match(/^(.*?)-(?:19|20)\d{2}$/)
  return (m ? m[1] : id).toLowerCase()
}

export function resolvePriorEdition(
  currentId: string,
  currentName: string,
  all: TournamentInfo[],
): TournamentInfo | null {
  const candidates = all.filter((t) => t.id !== currentId && t.done)
  const targetName = canonicalize(currentName)
  const byName = candidates.filter((t) => canonicalize(t.name) === targetName)
  if (byName.length === 1) return byName[0]
  if (byName.length > 1) {
    const sorted = byName.slice().sort((a, b) => (b.startDateIso ?? '').localeCompare(a.startDateIso ?? ''))
    const mostRecent = sorted[0]
    const tie = sorted.filter((t) => (t.startDateIso ?? '') === (mostRecent.startDateIso ?? ''))
    if (tie.length === 1) return mostRecent
    return null
  }
  const targetPrefix = idPrefix(currentId)
  const byPrefix = candidates.filter((t) => idPrefix(t.id) === targetPrefix)
  if (byPrefix.length === 1) return byPrefix[0]
  return null
}

export function buildPriorEditionWinners(
  prior: TournamentInfo | null,
  winnersByEvent: Map<string, { players: string[] }>,
  clubs: Record<string, string>,
): PriorEditionWinnerMap {
  const out: PriorEditionWinnerMap = new Map()
  if (!prior) return out
  for (const [event, w] of Array.from(winnersByEvent)) {
    const entry: PriorEditionWinnerEntry = {
      players: w.players,
      priorEditionId: prior.id,
      priorEditionLabel: prior.name,
    }
    const club = w.players.map((id: string) => clubs[id]).find((c: string | undefined) => c)
    if (club) entry.club = club
    out.set(event, entry)
  }
  return out
}
