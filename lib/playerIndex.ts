// Cross-tournament player index aggregator.
// Pure functions only — no I/O, no Date.now(), no console.

const SEED_PREFIX_RE = /^\s*(?:\[[^\]]*\]|\([^)]*\))\s*/

export function nameToSlug(raw: string): string {
  if (!raw) return ''
  let s = raw.replace(SEED_PREFIX_RE, '').trim()
  if (!s) return ''
  s = s.toLowerCase()
  const parts = s.split(/\s+/).filter(Boolean)
  return parts.map(p => encodeURIComponent(p)).join('_')
}
