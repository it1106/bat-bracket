// Short codes the user can type in the player-search box that also match
// a longer expanded term (typically a club name). Keys are lowercase.
const ALIASES: Record<string, string> = {
  kba: 'เกษมศักดิ์ Badminton Academy',
  bty: 'บ้านทองหยอด',
  ren: 'รวิณ',
  aston: 'นริศ'
}

function expandTerm(term: string): string[] {
  const t = term.trim().toLowerCase()
  if (!t) return []
  const expansion = ALIASES[t]
  return expansion ? [t, expansion.toLowerCase()] : [t]
}

// Parse a query into AND-groups separated by '&'. Each group is the list of
// OR alternatives for that term (the term itself plus any alias expansion).
// "BS U15 & BTY" → [["bs u15"], ["bty", "บ้านทองหยอด"]]. An empty/whitespace
// query (or one whose splits are all empty) returns [].
export function parseSearchQuery(query: string): string[][] {
  return query
    .split('&')
    .map(expandTerm)
    .filter((g) => g.length > 0)
}

// Flat list of every term/expansion across all AND-groups. Used where we
// want OR-style behavior (e.g. highlighting any name that matches any term
// the user typed), rather than the AND filter applied at match level.
export function expandSearchQuery(query: string): string[] {
  return parseSearchQuery(query).flat()
}
