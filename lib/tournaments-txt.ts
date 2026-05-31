import { lookupByUrl as defaultLookupByUrl } from '@/lib/providers/bwf/sidecar'
import type { SidecarEntry } from '@/lib/providers/bwf/sidecar'
import type { TournamentInfo } from '@/lib/types'

export interface ParsedTxt {
  manualEntries: TournamentInfo[]
  denySet: Set<string>
  /** Case-folded substrings; an entry is denied if its name contains any of them. */
  denyNamePatterns: string[]
}

export interface ParseDeps {
  lookupByUrl?: (url: string) => SidecarEntry | null
  onUnresolved?: (url: string) => void
}

const DENY_RE = /^#\s*deny\s+([A-Fa-f0-9-]{36})/
// `# deny-name <substring>` — case-insensitive substring match against the
// tournament name. Useful for recurring series whose GUID changes every year
// (e.g. กีฬาบุคคล, กีฬาอาวุโสแห่งชาติ).
const DENY_NAME_RE = /^#\s*deny-name\s+(.+?)\s*$/
const BWF_RE = /^@bwf\s+(https?:\/\/\S+?)\s*(?:\[done\])?\s*$/
const BWF_DONE_RE = /^@bwf\s+\S+\s+\[done\]\s*$/

export function parseTournamentsTxt(content: string, deps: ParseDeps = {}): ParsedTxt {
  const lookup = deps.lookupByUrl ?? defaultLookupByUrl
  const lines = content.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)
  const denySet = new Set<string>()
  const denyNamePatterns: string[] = []
  const manualEntries: TournamentInfo[] = []

  for (const l of lines) {
    const denyMatch = DENY_RE.exec(l)
    if (denyMatch) { denySet.add(denyMatch[1].toUpperCase()); continue }
    const denyNameMatch = DENY_NAME_RE.exec(l)
    if (denyNameMatch) {
      const pat = denyNameMatch[1].toLowerCase()
      if (pat.length > 0) denyNamePatterns.push(pat)
      continue
    }
    if (l.startsWith('@bwf')) {
      const m = BWF_RE.exec(l)
      if (!m) continue
      const url = m[1]
      const done = BWF_DONE_RE.test(l)
      const entry = lookup(url)
      if (!entry) { deps.onUnresolved?.(url); continue }
      manualEntries.push({
        id: entry.tournamentCode.toUpperCase(),
        name: entry.name,
        provider: 'bwf',
        ...(entry.startDateIso && { startDateIso: entry.startDateIso }),
        ...(done && { done: true }),
      })
      continue
    }
    if (l.startsWith('#')) continue
    const spaceIdx = l.indexOf(' ')
    if (spaceIdx === -1) { manualEntries.push({ id: l.toUpperCase(), name: l }); continue }
    const id = l.slice(0, spaceIdx).toUpperCase()
    const rest = l.slice(spaceIdx + 1).trim()
    const manualDone = rest.endsWith('[done]')
    const name = manualDone ? rest.slice(0, -6).trim() : rest
    manualEntries.push({ id, name, ...(manualDone && { done: true }) })
  }
  return { manualEntries, denySet, denyNamePatterns }
}
