// Short codes the user can type in the player-search box that also match
// a longer expanded term (typically a club name). Keys are lowercase.
const ALIASES: Record<string, string> = {
  kba: 'เกษมศักดิ์ Badminton Academy',
  bty: 'บ้านทองหยอด',
  ren: 'รวิณ',
  aston: 'นริศ'
}

// Returns the lowercased query plus any alias expansion to also match against.
// An empty/whitespace input returns an empty list (caller treats as "no filter").
export function expandSearchQuery(query: string): string[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const expansion = ALIASES[q]
  return expansion ? [q, expansion.toLowerCase()] : [q]
}
