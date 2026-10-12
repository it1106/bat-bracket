import type { MatchEntry, MatchScheduleGroup } from './types'

// Typeahead for the player-search box. The box takes a small query language
// ('&' = AND, '|' = OR, see parseSearchQuery), so completion works on the one
// segment the reader is typing and leaves the rest of the query untouched.

export type SuggestionKind = 'player' | 'event'

export interface Suggestion {
  value: string
  kind: SuggestionKind
}

/** The segment being typed, with its offsets in `query`. Offsets bound the
 *  trimmed text, so replacing it keeps the spacing around the separator. */
export interface Term {
  text: string
  start: number
  end: number
}

const SEPARATORS = ['&', '|']
const DEFAULT_LIMIT = 8

export function currentTerm(query: string): Term {
  const cut = Math.max(...SEPARATORS.map((s) => query.lastIndexOf(s)))
  const segment = query.slice(cut + 1)
  const lead = segment.length - segment.trimStart().length
  const text = segment.trim()
  const start = cut + 1 + lead
  return { text, start, end: start + text.length }
}

export function replaceTerm(query: string, value: string): string {
  const { start, end } = currentTerm(query)
  return query.slice(0, start) + value + query.slice(end)
}

/** Candidates matching the typed term, best first and capped. Substring,
 *  case-insensitive — the same test the search filter itself applies. */
export function buildSuggestions(
  candidates: readonly Suggestion[],
  term: string,
  limit: number = DEFAULT_LIMIT,
): Suggestion[] {
  const q = term.trim().toLowerCase()
  if (!q) return []

  const seen = new Set<string>()
  const scored: Array<{ suggestion: Suggestion; score: number }> = []
  for (const candidate of candidates) {
    const value = candidate.value.trim()
    if (!value) continue
    const lc = value.toLowerCase()
    // Nothing left to complete once the term already spells the candidate out.
    if (lc === q) continue
    const score = lc.indexOf(q)
    if (score === -1) continue
    if (seen.has(lc)) continue
    seen.add(lc)
    scored.push({ suggestion: { value, kind: candidate.kind }, score })
  }

  // Prefix match (index 0) first, then the earliest match, then alphabetical.
  scored.sort(
    (a, b) =>
      a.score - b.score || a.suggestion.value.localeCompare(b.suggestion.value),
  )
  return scored.slice(0, limit).map((s) => s.suggestion)
}

// Names are rendered with their seeding ("Somchai Suksawat [1]"), which is
// chrome rather than part of the name. The bare name still matches the stored
// one, and the seeded and unseeded spellings of a player collapse into one
// suggestion instead of two.
const SEED_MARKER = /\s*\[\d+(?:\s*\/\s*\d+)?\]\s*$/

function playerName(raw: string): string {
  return raw.replace(SEED_MARKER, '').trim()
}

/** Players and draw names in a set of matches, in reading order. The same
 *  fields the search filter looks at: entry.draw and each side's players. */
export function candidatesFromMatches(
  ...lists: ReadonlyArray<readonly MatchEntry[]>
): Suggestion[] {
  const out: Suggestion[] = []
  for (const matches of lists) {
    for (const m of matches) {
      if (m.draw?.trim()) out.push({ value: m.draw.trim(), kind: 'event' })
      for (const p of [...m.team1, ...m.team2]) {
        const name = playerName(p.name ?? '')
        if (name) out.push({ value: name, kind: 'player' })
      }
    }
  }
  return out
}

/** Same, for the day schedule's time/court groups. */
export function candidatesFromScheduleGroups(
  groups: readonly MatchScheduleGroup[],
): Suggestion[] {
  return candidatesFromMatches(...groups.map((g) => g.matches))
}

// Bracket views hold only rendered HTML, so names are read back out of it with
// the selectors applyPlayerHighlight() uses — the two stay in step that way.
const BRACKET_NAME_SELECTOR =
  '.bk-row .bk-player, .match__row .match__row-title-value-content a'

export function candidatesFromBracketHtml(html: string): Suggestion[] {
  if (!html.trim() || typeof DOMParser === 'undefined') return []
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const out: Suggestion[] = []
  doc.querySelectorAll(BRACKET_NAME_SELECTOR).forEach((el) => {
    const name = playerName(el.textContent ?? '')
    if (name) out.push({ value: name, kind: 'player' })
  })
  return out
}

/** The AND groups already typed, i.e. everything before the last '&'. The
 *  view is narrowed by these before candidates are collected, so completing
 *  "BS U15 & som" only offers players who are actually in BS U15. A trailing
 *  '|' group is left alone: it adds alternatives to the current group rather
 *  than narrowing it. */
export function andPrefix(query: string): string {
  const cut = query.lastIndexOf('&')
  return cut === -1 ? '' : query.slice(0, cut).trim()
}
