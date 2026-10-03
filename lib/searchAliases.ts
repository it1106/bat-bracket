import { useSyncExternalStore } from 'react'

import { DEFAULT_ALIASES } from './searchAliasDefaults'

// Short codes the user can type in the player-search box that also match
// a longer expanded term (typically a club or player name). Keys are lowercase.
//
// The built-in ones live in ./searchAliasDefaults. The live list is managed on
// the /bmstats page and kept on the server; SearchAliasesLoader fetches it at
// page load and swaps it in with setSearchAliases(). Until then (and if the
// fetch fails) the built-ins apply.
export { DEFAULT_ALIASES }

let ALIASES: Record<string, string> = { ...DEFAULT_ALIASES }
let version = 0
const listeners = new Set<() => void>()

/** Replaces the alias table. Entries that are not text are dropped. */
export function setSearchAliases(next: Readonly<Record<string, string>>): void {
  const clean: Record<string, string> = {}
  for (const [key, value] of Object.entries(next)) {
    if (typeof value === 'string' && value.trim()) clean[key.trim().toLowerCase()] = value.trim()
  }
  ALIASES = clean
  version++
  listeners.forEach((notify) => notify())
}

function subscribe(notify: () => void): () => void {
  listeners.add(notify)
  return () => listeners.delete(notify)
}

/** Changes whenever the alias table is replaced. Read it in a component (or
 *  put it in a hook's dependency list) so searches re-run with the new table. */
export function useSearchAliasesVersion(): number {
  return useSyncExternalStore(subscribe, () => version, () => 0)
}

const MIN_PREFIX = 2

function expandTerm(term: string): string[] {
  const t = term.trim().toLowerCase()
  if (!t) return []
  const expansions =
    t.length >= MIN_PREFIX
      ? Object.entries(ALIASES)
          .filter(([key]) => key.startsWith(t))
          .map(([, value]) => value.toLowerCase())
      : []
  return [t, ...expansions]
}

// Parse a query into AND-groups separated by '&'. Within each group, '|'
// adds explicit OR alternatives, and every term still gets alias expansion.
// "BS U15 & kba | bty" → [["bs u15"], ["kba", "เกษมศักดิ์ badminton academy",
// "bty", "บ้านทองหยอด"]]. An empty/whitespace query (or one whose splits
// are all empty) returns [].
export function parseSearchQuery(query: string): string[][] {
  return query
    .split('&')
    .map((part) => part.split('|').flatMap(expandTerm))
    .filter((g) => g.length > 0)
}

// Flat list of every term/expansion across all AND-groups. Used where we
// want OR-style behavior (e.g. highlighting any name that matches any term
// the user typed), rather than the AND filter applied at match level.
export function expandSearchQuery(query: string): string[] {
  return parseSearchQuery(query).flat()
}
